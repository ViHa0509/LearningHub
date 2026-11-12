"""Spec: ai-news - News sources; Refresh the news; Read the news.

A fake feed server on 127.0.0.2 serves synthetic RSS and Atom feeds (items under
https://example.test/); the configured feed URLs (https://feeds.example.test/...) are mapped to
it by the injected fetcher, which still uses ``fetch_feed`` with only that address allowed.
Nothing reaches the real feeds.
"""

import socket
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, ClassVar

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import REPO_ROOT, Settings
from app.db import NewsItem
from app.main import create_app
from app.news.sources import NewsSourcesError, load_sources
from app.resources.fetch import FetchPolicy, fetch_feed
from tests.conftest import SERVERLESS, TEST_DATABASE_URL, signed_in_client

FAKE_IP = "127.0.0.2"
FEED_HOST = "feeds.example.test"

SOURCES = """\
sources:
  - id: mit-news
    name: MIT News (AI)
    homepage: https://news.example.test/
    feed: https://feeds.example.test/mit.xml
  - id: lab
    name: Synthetic Lab
    homepage: https://lab.example.test/
    feed: https://feeds.example.test/atom.xml
  - id: broken
    name: Broken Source
    homepage: https://broken.example.test/
    feed: https://feeds.example.test/error
  - id: unsafe
    name: Unsafe Source
    homepage: https://unsafe.example.test/
    feed: https://feeds.example.test/entity.xml
  - id: internal
    name: Internal Source
    homepage: https://internal.example.test/
    feed: https://feeds.example.test/to-internal
"""


def ago(**delta: float) -> datetime:
    return datetime.now(UTC).replace(microsecond=0) - timedelta(**delta)


def rss(*items: tuple[str, str, datetime, str]) -> bytes:
    body = "".join(
        f"<item><title>{title}</title><link>{url}</link>"
        f"<pubDate>{format_datetime(date)}</pubDate>"
        f"<description><![CDATA[{summary}]]></description></item>"
        for title, url, date, summary in items
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>S</title>'
        f"{body}</channel></rss>"
    ).encode()


def atom(*entries: tuple[str, str, datetime, str]) -> bytes:
    body = "".join(
        f'<entry><title>{title}</title><link href="{url}"/>'
        f"<updated>{date.isoformat()}</updated><summary>{summary}</summary></entry>"
        for title, url, date, summary in entries
    )
    return f'<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>{body}</feed>'.encode()


class Feeds:
    """State of the fake feed server, changed by tests."""

    mit_title: ClassVar[str] = "New robot hands"
    gate: ClassVar[threading.Event | None] = None
    times: ClassVar[dict[str, datetime]] = {}


def mit_feed() -> bytes:
    t = Feeds.times
    return rss(
        (
            Feeds.mit_title,
            "https://example.test/mit/robot-hands",
            t["mit1"],
            "<p>Grippers <b>learn</b></p><script>steal()</script><style>p{}</style>",
        ),
        ("Language models", "https://example.test/mit/llm", t["mit2"], "About a ROBOT arm"),
        ("Climate data", "https://example.test/mit/climate", t["mit3"], "Weather 100% data"),
        ("Very old robot", "https://example.test/mit/old", t["old"], "Too old to keep"),
    )


def lab_feed() -> bytes:
    t = Feeds.times
    return atom(
        ("Robot lab news", "https://example.test/lab/robots", t["lab1"], "From the lab"),
        ("Second lab post", "https://example.test/lab/second", t["lab2"], "More"),
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass

    def send(self, status: int, body: bytes, content_type: str, **headers: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        port = self.server.server_address[1]
        if self.path == "/mit.xml":
            if Feeds.gate is not None:
                Feeds.gate.wait(5)
            self.send(200, mit_feed(), "application/rss+xml; charset=utf-8")
        elif self.path == "/atom.xml":
            self.send(200, lab_feed(), "application/atom+xml")
        elif self.path == "/error":
            self.send(500, b"boom", "text/plain")
        elif self.path == "/entity.xml":
            body = rss(("Entity item", "https://example.test/unsafe/1", ago(hours=1), "x"))
            body = body.replace(b"<rss", b'<!DOCTYPE rss [<!ENTITY boom "boom">]><rss', 1)
            self.send(200, body, "application/xml")
        elif self.path == "/to-internal":
            self.send(302, b"", "text/plain", Location=f"http://127.0.0.1:{port}/mit.xml")
        else:
            self.send(404, b"no", "text/plain")


@pytest.fixture(scope="module")
def port() -> Iterator[int]:
    server = ThreadingHTTPServer((FAKE_IP, 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server.server_address[1]
    server.shutdown()


@pytest.fixture(autouse=True)
def reset_feeds() -> None:
    Feeds.mit_title = "New robot hands"
    Feeds.gate = None
    Feeds.times = {
        "mit1": ago(hours=2),
        "mit2": ago(days=1),
        "mit3": ago(days=3),
        "old": ago(days=120),
        "lab1": ago(hours=5),
        "lab2": ago(days=2),
    }


def resolve(host: str, port: int, *_: Any) -> list[tuple[Any, ...]]:
    table = {FEED_HOST: FAKE_IP, "127.0.0.1": "127.0.0.1"}
    if host not in table:
        raise socket.gaierror("unknown host")
    return [(2, 1, 6, "", (table[host], port))]


def make_fetcher(port: int) -> Callable[[str], str]:
    policy = FetchPolicy(resolve=resolve, allowed=lambda a: a == FAKE_IP)

    def fetch(url: str) -> str:
        local = url.replace(f"https://{FEED_HOST}/", f"http://{FEED_HOST}:{port}/")
        return fetch_feed(local, policy)

    return fetch


@pytest.fixture
def news_settings(tmp_path: Path, settings_factory: Callable[..., Settings]) -> Settings:
    path = tmp_path / "sources.yaml"
    path.write_text(SOURCES, encoding="utf-8")
    return settings_factory(news_sources_file=path)


def open_client(settings: Settings, port: int, headers: dict[str, str]) -> Iterator[TestClient]:
    app = create_app(settings)
    app.state.news_fetcher = make_fetcher(port)
    with signed_in_client(app, headers=headers) as test_client:
        yield test_client
    app.state.engine.dispose()


@pytest.fixture
def api(news_settings: Settings, port: int) -> Iterator[TestClient]:
    yield from open_client(news_settings, port, {"X-LearningHub": "1"})


def wait_done(api: TestClient, timeout: float = 15) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status: dict[str, Any] = api.get("/api/news/refresh").json()
        if status["state"] not in ("running", "idle"):
            return status
        time.sleep(0.02)
    raise AssertionError("the refresh did not finish in time")


def refresh(api: TestClient) -> dict[str, Any]:
    response = api.post("/api/news/refresh")
    assert response.status_code == 202, response.text
    return wait_done(api)


def stored() -> list[tuple[str, str, str]]:
    engine = create_engine(TEST_DATABASE_URL)
    with Session(engine) as session:
        rows = session.scalars(select(NewsItem)).all()
        result = sorted((r.source, r.url, r.title) for r in rows)
    engine.dispose()
    return result


EXPECTED_URLS = {
    "https://example.test/lab/robots",
    "https://example.test/lab/second",
    "https://example.test/mit/climate",
    "https://example.test/mit/llm",
    "https://example.test/mit/robot-hands",
}


# Scenario: Refresh with one failing source; Scenario: Unsafe feed
def test_refresh_with_failing_and_unsafe_sources(api: TestClient) -> None:
    assert api.get("/api/news/refresh").json() == {
        "state": "idle",
        "started_at": None,
        "finished_at": None,
        "error": None,
        "sources": [],
    }
    status = refresh(api)
    assert status["state"] == "done", status
    assert status["error"] is None
    assert status["started_at"] and status["finished_at"]
    results = {s["id"]: s for s in status["sources"]}
    assert list(results) == ["mit-news", "lab", "broken", "unsafe", "internal"]
    assert results["mit-news"] == {
        "id": "mit-news",
        "name": "MIT News (AI)",
        "ok": True,
        "items": 3,
        "error": None,
    }
    assert (results["lab"]["ok"], results["lab"]["items"]) == (True, 2)
    assert results["broken"]["ok"] is False and "status 500" in results["broken"]["error"]
    assert results["unsafe"]["ok"] is False
    assert "declares a DTD or entities" in results["unsafe"]["error"]
    assert results["internal"]["ok"] is False
    assert "private or reserved" in results["internal"]["error"]

    rows = stored()
    assert {url for _, url, _ in rows} == EXPECTED_URLS
    assert {source for source, _, _ in rows} == {"mit-news", "lab"}

    news = api.get("/api/news").json()
    sources = {s["id"]: s for s in news["sources"]}
    assert sources["mit-news"]["count"] == 3 and sources["lab"]["count"] == 2
    assert sources["broken"]["count"] == 0
    assert sources["mit-news"]["last_ok"] is True and sources["mit-news"]["last_error"] is None
    assert sources["broken"]["last_ok"] is False
    assert "status 500" in sources["broken"]["last_error"]
    assert sources["broken"]["last_fetched_at"] is not None
    assert sources["lab"]["homepage"] == "https://lab.example.test/"
    assert news["stale"] is False and news["last_refresh_at"] is not None


# Scenario: Refresh twice
def test_refresh_twice_stores_each_item_once_and_updates_it(api: TestClient) -> None:
    refresh(api)
    first = stored()
    Feeds.mit_title = "New robot hands (updated)"
    Feeds.times["mit1"] = ago(hours=1)
    assert refresh(api)["state"] == "done"
    second = stored()
    assert len(second) == len(first) == 5
    assert ("mit-news", "https://example.test/mit/robot-hands", "New robot hands (updated)") in (
        second
    )
    items = api.get("/api/news", params={"source": "mit-news"}).json()["items"]
    assert items[0]["title"] == "New robot hands (updated)"
    published = datetime.fromisoformat(items[0]["published_at"])
    assert published == Feeds.times["mit1"]


# Scenario: Refresh needs the app header
def test_refresh_needs_the_app_header(news_settings: Settings, port: int) -> None:
    for bare in open_client(news_settings, port, {}):
        response = bare.post("/api/news/refresh")
        assert response.status_code == 403
        assert bare.get("/api/news/refresh").json()["state"] == "idle"
        # Reading needs no header.
        assert bare.get("/api/news").status_code == 200


def test_a_second_refresh_while_running_returns_the_running_job(api: TestClient) -> None:
    Feeds.gate = threading.Event()
    try:
        first = api.post("/api/news/refresh")
        second = api.post("/api/news/refresh")
        assert first.status_code == second.status_code == 202
        assert first.json()["state"] == second.json()["state"] == "running"
        assert first.json()["started_at"] == second.json()["started_at"]
        pending = {s["id"]: s for s in api.get("/api/news/refresh").json()["sources"]}
        assert pending["mit-news"] == {
            "id": "mit-news",
            "name": "MIT News (AI)",
            "ok": None,
            "items": None,
            "error": None,
        }
    finally:
        Feeds.gate.set()
    assert wait_done(api)["state"] == "done"


def test_refresh_fails_when_every_source_fails(
    tmp_path: Path, settings_factory: Callable[..., Settings], port: int
) -> None:
    path = tmp_path / "bad-only.yaml"
    path.write_text(
        "sources:\n"
        "  - id: broken\n    name: Broken\n    homepage: https://b.example.test/\n"
        "    feed: https://feeds.example.test/error\n"
        "  - id: unsafe\n    name: Unsafe\n    homepage: https://u.example.test/\n"
        "    feed: https://feeds.example.test/entity.xml\n",
        encoding="utf-8",
    )
    for api in open_client(settings_factory(news_sources_file=path), port, {"X-LearningHub": "1"}):
        status = refresh(api)
        assert status["state"] == "failed" and status["error"] == "every source failed"
        assert [s["ok"] for s in status["sources"]] == [False, False]
    assert stored() == []


# Scenario: Filter by source and text
def test_filter_by_source_and_text_newest_first(api: TestClient) -> None:
    refresh(api)
    items = api.get("/api/news", params={"source": "mit-news", "q": "robot"}).json()["items"]
    assert [i["url"] for i in items] == [
        "https://example.test/mit/robot-hands",  # title
        "https://example.test/mit/llm",  # summary, other case
    ]
    first = items[0]
    assert first["source"] == "mit-news" and first["source_name"] == "MIT News (AI)"
    assert set(first) == {"id", "source", "source_name", "title", "url", "published_at", "summary"}

    everything = api.get("/api/news").json()["items"]
    dates = [i["published_at"] for i in everything]
    assert dates == sorted(dates, reverse=True) and len(everything) == 5
    assert [i["url"] for i in api.get("/api/news", params={"q": "ROBOT"}).json()["items"]] == [
        "https://example.test/mit/robot-hands",
        "https://example.test/lab/robots",
        "https://example.test/mit/llm",
    ]
    # LIKE wildcards are matched literally.
    assert [i["url"] for i in api.get("/api/news", params={"q": "100%"}).json()["items"]] == [
        "https://example.test/mit/climate"
    ]
    assert [i["url"] for i in api.get("/api/news", params={"q": "%"}).json()["items"]] == [
        "https://example.test/mit/climate"
    ]
    assert api.get("/api/news", params={"q": "_"}).json()["items"] == []
    assert api.get("/api/news", params={"source": "nope"}).json()["items"] == []


def test_paging_with_limit_and_before(api: TestClient) -> None:
    refresh(api)
    everything = [i["url"] for i in api.get("/api/news").json()["items"]]
    page = api.get("/api/news", params={"limit": 2}).json()["items"]
    assert [i["url"] for i in page] == everything[:2]
    rest = api.get("/api/news", params={"limit": 2, "before": page[-1]["published_at"]}).json()[
        "items"
    ]
    assert [i["url"] for i in rest] == everything[2:4]
    for bad in (0, 101):
        assert api.get("/api/news", params={"limit": bad}).status_code == 422
    assert api.get("/api/news", params={"before": "not a date"}).status_code == 422


# Scenario: Summary is plain text
def test_summary_is_plain_text(api: TestClient) -> None:
    refresh(api)
    items = api.get("/api/news", params={"source": "mit-news"}).json()["items"]
    summary = next(i for i in items if i["url"].endswith("robot-hands"))["summary"]
    assert summary == "Grippers learn"
    assert all(len(i["summary"]) <= 400 for i in items)


def test_items_older_than_90_days_are_removed(api: TestClient) -> None:
    engine = create_engine(TEST_DATABASE_URL)
    with Session(engine) as session:
        session.add_all(
            [
                NewsItem(
                    id=uuid.uuid4(),
                    source="lab",
                    title="Ancient",
                    url="https://example.test/ancient",
                    published_at=ago(days=91),
                    summary="",
                ),
                NewsItem(
                    id=uuid.uuid4(),
                    source="lab",
                    title="Recent, no longer in the feed",
                    url="https://example.test/recent",
                    published_at=ago(days=89),
                    summary="",
                ),
            ]
        )
        session.commit()
    engine.dispose()
    refresh(api)
    urls = {url for _, url, _ in stored()}
    assert "https://example.test/ancient" not in urls
    assert "https://example.test/mit/old" not in urls  # 120 days old in the feed
    assert "https://example.test/recent" in urls


def test_never_refreshed_is_stale(api: TestClient) -> None:
    news = api.get("/api/news").json()
    assert news["items"] == [] and news["stale"] is True and news["last_refresh_at"] is None
    assert [s["id"] for s in news["sources"]] == ["mit-news", "lab", "broken", "unsafe", "internal"]
    assert all(
        s["count"] == 0 and s["last_ok"] is None and s["last_fetched_at"] is None
        for s in news["sources"]
    )


# Scenario: Invalid source
@pytest.mark.parametrize(
    ("text", "reason"),
    [
        (
            SOURCES.replace("https://feeds.example.test/error", "http://feeds.example.test/e"),
            "'broken': feed must be an https URL",
        ),
        (SOURCES.replace("id: lab", "id: mit-news"), "duplicate source id 'mit-news'"),
        (SOURCES.replace("id: lab", "id: Lab_1"), "invalid id 'Lab_1'"),
        (
            SOURCES.replace("homepage: https://lab.example.test/", "homepage: ftp://x"),
            "'lab': homepage",
        ),
        (SOURCES.replace("    name: Synthetic Lab\n", ""), "'lab' has no name"),
        ("sources: []\n", "non-empty 'sources' list"),
        ("sources: [\n", "invalid YAML"),
    ],
)
def test_invalid_sources_stop_the_server(
    tmp_path: Path, settings_factory: Callable[..., Settings], text: str, reason: str
) -> None:
    path = tmp_path / "sources.yaml"
    path.write_text(text, encoding="utf-8")
    with pytest.raises(NewsSourcesError, match=reason) as caught:
        create_app(settings_factory(news_sources_file=path))
    assert str(caught.value).startswith("news/sources.yaml: ")


def test_missing_sources_file_stops_the_server(
    tmp_path: Path, settings_factory: Callable[..., Settings]
) -> None:
    with pytest.raises(NewsSourcesError, match="cannot be read"):
        create_app(settings_factory(news_sources_file=tmp_path / "missing.yaml"))


def test_the_repository_sources_are_valid() -> None:
    sources = load_sources(REPO_ROOT / "news" / "sources.yaml")
    assert [s.id for s in sources] == [
        "mit-news",
        "google-ai",
        "openai",
        "hugging-face",
        "mit-tech-review",
        "bair",
        "apple-ml",
        "aws-ml",
    ]
    assert all(s.feed.startswith("https://") for s in sources)


# Spec: delivery - Jobs finish inside the request in serverless mode
# Scenario: News refresh on Vercel
def test_serverless_refresh_answers_the_final_status_and_saves_it(
    news_settings: Settings, port: int
) -> None:
    settings = news_settings.model_copy(update=SERVERLESS)
    first = open_client(settings, port, {"X-LearningHub": "1"})
    second = open_client(settings, port, {"X-LearningHub": "1"})
    api, other = next(first), next(second)
    response = api.post("/api/news/refresh")
    assert response.status_code == 202
    status = response.json()
    # Finished inside the request: nothing is left running, one failing source is named.
    assert status["state"] == "done" and status["finished_at"]
    results = {s["id"]: s for s in status["sources"]}
    assert results["mit-news"]["ok"] is True and results["broken"]["ok"] is False
    assert results["broken"]["error"]
    # Another instance (its own memory) answers the same status and the same list details.
    assert other.get("/api/news/refresh").json() == status
    listed = other.get("/api/news").json()
    assert listed["stale"] is False and listed["last_refresh_at"]
    by_id = {s["id"]: s for s in listed["sources"]}
    assert by_id["broken"]["last_ok"] is False and by_id["mit-news"]["last_ok"] is True
    assert {url for _, url, _ in stored()} == EXPECTED_URLS
    for client in (first, second):
        client.close()
