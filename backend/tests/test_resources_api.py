"""Spec: node-resources - Sync resource links; Read a node's references.

A fake source on 127.0.0.1 serves a synthetic tree listing and synthetic node files (titles and
URLs under https://example.test/); nothing reaches GitHub or roadmap.sh.
"""

import json
import shutil
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import replace
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, ClassVar

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.config import REPO_ROOT, Settings
from app.db import NodeResource
from app.main import create_app
from app.resources.mapping import ResourceRef
from app.resources.sync import SyncError, collect
from app.sync_resources import main as sync_command
from tests.conftest import SERVERLESS, TEST_DATABASE_URL, signed_in_client

COMMIT = "abc1234"
REPO = "/kamranahmedse/developer-roadmap"
CONTENT = f"{REPO}/{COMMIT}/roadmaps"

MAPPING = f"""\
domain: frontend
source: roadmap.sh
commit: {COMMIT}
nodes:
  html:
    - frontend/html
    - html/*
  css:
    - css/box-model
"""


def node_file(*links: str) -> bytes:
    body = "# Synthetic\n\nMade-up description text, never stored.\n\n" + "\n".join(links)
    return body.encode("utf-8")


FILES: dict[str, bytes] = {
    "frontend/content/html@f1.md": node_file(
        "- [@article@Zeta Article](https://example.test/zeta)",
        "- [@official@Example Spec](https://example.test/spec)",
        "- [@video@A Video](https://example.test/video)",
    ),
    "html/content/semantics@h1.md": node_file(
        "- [@article@alpha article](https://example.test/alpha)",
        # Same URL as in frontend/html: stored once for the node.
        "- [@official@Example Spec again](https://example.test/spec)",
        "- [@podcast@A Podcast](https://example.test/podcast)",
    ),
    "html/content/forms@h2.md": node_file(
        "- [@course@A Course](https://example.test/course)",
        "- [@feed@Some Feed](https://example.test/feed)",
    ),
    "css/content/box-model@c1.md": node_file(
        "- [@article@Box Model](https://example.test/box-model)",
    ),
    "css/content/display@c2.md": node_file(
        "- [@article@Display](https://example.test/display)",
    ),
}


class Source:
    """State of the fake source, changed by tests."""

    failing: ClassVar[set[str]] = set()
    gate: ClassVar[threading.Event | None] = None
    requests: ClassVar[list[str]] = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass

    def send(self, status: int, body: bytes, content_type: str = "text/plain") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        Source.requests.append(self.path)
        if self.path == f"/api/repos{REPO}/git/trees/{COMMIT}?recursive=1":
            if Source.gate is not None:
                Source.gate.wait(5)
            tree = [{"path": "roadmaps/frontend/frontend.md", "type": "blob"}]
            tree += [{"path": f"roadmaps/{name}", "type": "blob"} for name in FILES]
            tree.append({"path": "roadmaps/html/content", "type": "tree"})
            self.send(200, json.dumps({"tree": tree, "truncated": False}).encode())
            return
        prefix = f"/raw{CONTENT}/"
        name = self.path.removeprefix(prefix)
        if self.path.startswith(prefix) and name in Source.failing:
            self.send(500, b"boom")
        elif self.path.startswith(prefix) and name in FILES:
            self.send(200, FILES[name])
        else:
            self.send(404, b"not found")


@pytest.fixture(scope="module")
def source_url() -> Iterator[str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


@pytest.fixture(autouse=True)
def reset_source() -> None:
    Source.failing = set()
    Source.gate = None
    Source.requests = []


@pytest.fixture
def resource_settings(
    tmp_path: Path, settings_factory: Callable[..., Settings], source_url: str
) -> Settings:
    roadmaps = tmp_path / "roadmaps"
    (roadmaps / "sources").mkdir(parents=True)
    shutil.copy(REPO_ROOT / "roadmaps" / "frontend.yaml", roadmaps / "frontend.yaml")
    # A roadmap without a resource mapping.
    shutil.copy(REPO_ROOT / "roadmaps" / "devops.yaml", roadmaps / "devops.yaml")
    (roadmaps / "sources" / "frontend.yaml").write_text(MAPPING, encoding="utf-8")
    return settings_factory(
        roadmaps_dir=roadmaps,
        roadmap_api_base=f"{source_url}/api",
        roadmap_raw_base=f"{source_url}/raw",
    )


@pytest.fixture
def api(resource_settings: Settings) -> Iterator[TestClient]:
    app = create_app(resource_settings)
    with signed_in_client(app, headers={"X-LearningHub": "1"}) as test_client:
        yield test_client
    app.state.engine.dispose()


def wait_done(api: TestClient, domain: str = "frontend", timeout: float = 10) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status: dict[str, Any] = api.get(f"/api/resources/sync/{domain}").json()
        if status["state"] not in ("running", "idle"):
            return status
        time.sleep(0.02)
    raise AssertionError("the sync did not finish in time")


def stored() -> list[tuple[str, str, str, str]]:
    engine = create_engine(TEST_DATABASE_URL)
    with Session(engine) as session:
        rows = session.scalars(select(NodeResource)).all()
        result = sorted((r.node_id, r.url, r.type, r.source_ref) for r in rows)
    engine.dispose()
    return result


EXPECTED = [
    ("frontend/css", "https://example.test/box-model", "article", "css/box-model@c1"),
    ("frontend/html", "https://example.test/alpha", "article", "html/semantics@h1"),
    ("frontend/html", "https://example.test/course", "course", "html/forms@h2"),
    ("frontend/html", "https://example.test/feed", "feed", "html/forms@h2"),
    ("frontend/html", "https://example.test/podcast", "podcast", "html/semantics@h1"),
    ("frontend/html", "https://example.test/spec", "official", "frontend/html@f1"),
    ("frontend/html", "https://example.test/video", "video", "frontend/html@f1"),
    ("frontend/html", "https://example.test/zeta", "article", "frontend/html@f1"),
]


# Scenario: First sync
def test_first_sync(api: TestClient) -> None:
    assert api.get("/api/resources/sync/frontend").json()["state"] == "idle"
    response = api.post("/api/resources/sync", json={"domain": "frontend"})
    assert response.status_code == 202
    assert response.json()["state"] in ("running", "done")
    status = wait_done(api)
    assert status["state"] == "done", status
    assert (status["commit"], status["nodes"], status["links"], status["error"]) == (
        COMMIT,
        2,
        8,
        None,
    )
    assert status["started_at"] and status["finished_at"]
    assert stored() == EXPECTED
    # One tree listing; css/display is not mapped and is never fetched.
    assert sum("/git/trees/" in r for r in Source.requests) == 1
    assert not any("display@c2" in r for r in Source.requests)


# Scenario: Sync again
def test_sync_twice_stores_links_once(api: TestClient) -> None:
    for _ in range(2):
        api.post("/api/resources/sync", json={"domain": "frontend"})
        assert wait_done(api)["state"] == "done"
    assert stored() == EXPECTED


def test_sync_replaces_only_this_domain_and_source(api: TestClient) -> None:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO node_resources (id, node_id, url, title, type, source, source_ref, "
                "commit) VALUES "
                "(gen_random_uuid(), 'frontend/html', 'https://example.test/old', 'Old', "
                "'article', 'roadmap.sh', 'x/old@1', 'old0000'), "
                "(gen_random_uuid(), 'backend/caching', 'https://example.test/keep', 'Keep', "
                "'article', 'roadmap.sh', 'x/keep@1', 'old0000')"
            )
        )
    engine.dispose()
    api.post("/api/resources/sync", json={"domain": "frontend"})
    assert wait_done(api)["state"] == "done"
    urls = {(node, url) for node, url, _, _ in stored()}
    assert ("frontend/html", "https://example.test/old") not in urls
    assert ("backend/caching", "https://example.test/keep") in urls


# Scenario: Failed sync keeps the old links (a file fails part way)
def test_failed_sync_keeps_old_links(api: TestClient) -> None:
    api.post("/api/resources/sync", json={"domain": "frontend"})
    assert wait_done(api)["state"] == "done"
    Source.failing = {"html/content/forms@h2.md"}
    api.post("/api/resources/sync", json={"domain": "frontend"})
    status = wait_done(api)
    assert status["state"] == "failed"
    assert "500" in status["error"] and "forms@h2" in status["error"]
    assert stored() == EXPECTED


# Scenario: Failed sync keeps the old links (a mapped slug does not exist)
def test_unknown_slug_fails_and_names_it(api: TestClient) -> None:
    api.post("/api/resources/sync", json={"domain": "frontend"})
    assert wait_done(api)["state"] == "done"
    state = api.app.state  # type: ignore[attr-defined]
    mapping = state.resource_mappings["frontend"]
    state.resource_mappings["frontend"] = replace(
        mapping, nodes={**mapping.nodes, "frontend/css": (ResourceRef("css", "no-such-slug"),)}
    )
    before = len(Source.requests)
    api.post("/api/resources/sync", json={"domain": "frontend"})
    status = wait_done(api)
    assert status["state"] == "failed"
    assert "css/no-such-slug" in status["error"]
    assert stored() == EXPECTED
    # The slugs are checked before any node file is fetched.
    assert not any("/raw/" in r for r in Source.requests[before:])


def test_unknown_roadmap_fails_and_names_it(resource_settings: Settings, api: TestClient) -> None:
    mapping = api.app.state.resource_mappings["frontend"]  # type: ignore[attr-defined]
    broken = replace(mapping, nodes={"frontend/css": (ResourceRef("nope", "*"),)})
    with pytest.raises(SyncError, match="unknown roadmap 'nope'"):
        collect(broken, resource_settings)


def test_second_request_while_running_returns_the_running_job(api: TestClient) -> None:
    Source.gate = threading.Event()
    first = api.post("/api/resources/sync", json={"domain": "frontend"})
    second = api.post("/api/resources/sync", json={"domain": "frontend"})
    assert first.json()["state"] == second.json()["state"] == "running"
    assert first.json()["started_at"] == second.json()["started_at"]
    Source.gate.set()
    assert wait_done(api)["state"] == "done"
    assert sum("/git/trees/" in r for r in Source.requests) == 1


# Scenario: Sync needs the app header
def test_sync_without_header_is_refused(api: TestClient) -> None:
    response = api.post(
        "/api/resources/sync", json={"domain": "frontend"}, headers={"X-LearningHub": "0"}
    )
    assert response.status_code == 403
    assert api.get("/api/resources/sync/frontend").json()["state"] == "idle"
    assert Source.requests == []


def test_sync_of_unknown_domain_is_404(api: TestClient) -> None:
    assert api.post("/api/resources/sync", json={"domain": "devops"}).status_code == 404
    # A known roadmap without a mapping answers 200 "unavailable"; an unknown one is 404.
    unmapped = api.get("/api/resources/sync/devops")
    assert (unmapped.status_code, unmapped.json()["state"]) == (200, "unavailable")
    assert api.get("/api/resources/sync/not-a-domain").status_code == 404


def test_sync_command(
    resource_settings: Settings, monkeypatch: pytest.MonkeyPatch, capsys: Any
) -> None:
    monkeypatch.setattr("app.sync_resources.get_settings", lambda: resource_settings)
    assert sync_command(["--domain", "frontend"]) == 0
    assert "8 links on 2 nodes at abc1234" in capsys.readouterr().out
    assert stored() == EXPECTED
    Source.failing = {"css/content/box-model@c1.md"}
    assert sync_command(["--domain", "frontend"]) == 1
    assert "box-model@c1" in capsys.readouterr().err
    assert sync_command(["--domain", "backend"]) == 2


# Scenario: Synced node (order: official, course, book, article, ..., others; then title)
def test_read_synced_node_in_order(api: TestClient) -> None:
    api.post("/api/resources/sync", json={"domain": "frontend"})
    assert wait_done(api)["state"] == "done"
    body = api.get("/api/resources/frontend/html").json()
    assert body["node_id"] == "frontend/html"
    assert (body["source"], body["commit"]) == ("roadmap.sh", COMMIT)
    assert body["source_url"] == "https://roadmap.sh/frontend"
    assert datetime.fromisoformat(body["synced_at"]) <= datetime.now(UTC)
    assert [(i["type"], i["title"]) for i in body["items"]] == [
        ("official", "Example Spec"),
        ("course", "A Course"),
        ("article", "alpha article"),
        ("article", "Zeta Article"),
        ("video", "A Video"),
        ("podcast", "A Podcast"),
        ("feed", "Some Feed"),
    ]
    first = body["items"][0]
    assert first == {
        "url": "https://example.test/spec",
        "title": "Example Spec",
        "type": "official",
        "source_ref": "frontend/html@f1",
    }
    css = api.get("/api/resources/frontend/css").json()
    assert css["source_url"] == "https://roadmap.sh/css"


# Scenario: Not synced yet
def test_read_known_node_without_links(api: TestClient) -> None:
    body = api.get("/api/resources/frontend/react").json()
    assert body == {
        "node_id": "frontend/react",
        "source": "roadmap.sh",
        "commit": None,
        "synced_at": None,
        "source_url": "https://roadmap.sh/frontend",
        "items": [],
    }


# Scenario: Unknown node
def test_read_unknown_node_is_404(api: TestClient) -> None:
    response = api.get("/api/resources/frontend/not-a-node")
    assert response.status_code == 404
    assert response.json()["detail"] == "unknown node 'frontend/not-a-node'"


# Spec: delivery - Jobs finish inside the request in serverless mode
def test_serverless_sync_answers_the_final_status_and_saves_it(
    resource_settings: Settings,
) -> None:
    settings = resource_settings.model_copy(update=SERVERLESS)
    app, twin = create_app(settings), create_app(settings)
    headers = {"X-LearningHub": "1"}
    with (
        signed_in_client(app, headers=headers) as api,
        signed_in_client(twin, headers=headers) as other,
    ):
        response = api.post("/api/resources/sync", json={"domain": "frontend"})
        assert response.status_code == 202
        status = response.json()
        assert (status["state"], status["nodes"], status["links"]) == ("done", 2, 8)
        assert stored() == EXPECTED
        # Another instance (its own memory) reads the saved status.
        assert other.get("/api/resources/sync/frontend").json() == status

        # Scenario: Failed reference sync
        Source.failing = {"html/content/forms@h2.md"}
        failed = other.post("/api/resources/sync", json={"domain": "frontend"}).json()
        assert failed["state"] == "failed" and "forms@h2" in failed["error"]
        assert api.get("/api/resources/sync/frontend").json() == failed
        assert stored() == EXPECTED
    app.state.engine.dispose()
    twin.state.engine.dispose()
