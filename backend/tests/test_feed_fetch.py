"""Spec: ai-news - Refresh the news (feeds are fetched like references, XML only).

A fake server on 127.0.0.2 serves synthetic feeds; the tests allow only that address, so a
redirect to 127.0.0.1 is "internal" exactly as a private address is in production.
"""

import socket
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest

from app.resources.fetch import FEED_TYPES, FetchError, FetchPolicy, fetch_feed

FAKE_IP = "127.0.0.2"
HOST = "feeds.example.test"
RSS = (
    b'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>T</title>'
    b"<item><title>Caf\xc3\xa9</title><link>https://example.test/a</link></item>"
    b"</channel></rss>"
)
LATIN1 = b'<?xml version="1.0" encoding="ISO-8859-1"?><rss><title>Caf\xe9</title></rss>'


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
        kind = self.path.removeprefix("/type/")
        if self.path.startswith("/type/"):
            self.send(200, RSS, kind.replace("_", "/") + "; charset=utf-8")
        elif self.path == "/latin1":
            self.send(200, LATIN1, "application/xml")
        elif self.path == "/bom":
            self.send(200, b"\xef\xbb\xbf" + RSS, "application/rss+xml")
        elif self.path == "/html":
            self.send(200, b"<html><body>not a feed</body></html>", "text/html")
        elif self.path == "/to-feed":
            self.send(301, b"", "text/plain", Location="/type/application_rss+xml")
        elif self.path == "/to-internal":
            self.send(302, b"", "text/plain", Location=f"http://127.0.0.1:{port}/type/text_xml")
        elif self.path == "/loop":
            self.send(302, b"", "text/plain", Location="/loop")
        elif self.path == "/big":
            self.send(200, b"<rss>" + b"x" * 5000 + b"</rss>", "application/rss+xml")
        elif self.path == "/error":
            self.send(500, b"boom", "text/plain")
        else:
            self.send(404, b"no", "text/plain")


@pytest.fixture(scope="module")
def port() -> Iterator[int]:
    server = ThreadingHTTPServer((FAKE_IP, 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server.server_address[1]
    server.shutdown()


def resolve(host: str, port: int, *_: Any) -> list[tuple[Any, ...]]:
    table = {HOST: FAKE_IP, "127.0.0.1": "127.0.0.1"}
    if host not in table:
        raise socket.gaierror("unknown host")
    return [(2, 1, 6, "", (table[host], port))]


def policy(**overrides: Any) -> FetchPolicy:
    return FetchPolicy(resolve=resolve, allowed=lambda a: a == FAKE_IP, **overrides)


def url(port: int, path: str) -> str:
    return f"http://{HOST}:{port}{path}"


@pytest.mark.parametrize("media", FEED_TYPES)
def test_reads_each_feed_content_type_as_raw_text(port: int, media: str) -> None:
    text = fetch_feed(url(port, "/type/" + media.replace("/", "_")), policy())
    assert text.startswith("<?xml") and "<title>Café</title>" in text


def test_uses_the_xml_declaration_charset_and_drops_a_bom(port: int) -> None:
    assert "<title>Café</title>" in fetch_feed(url(port, "/latin1"), policy())
    assert fetch_feed(url(port, "/bom"), policy()).startswith("<?xml")


def test_follows_a_checked_redirect(port: int) -> None:
    assert "<rss" in fetch_feed(url(port, "/to-feed"), policy())


# Scenario: Unsafe feed (redirect to a private address)
def test_redirect_to_an_internal_address_is_refused(port: int) -> None:
    with pytest.raises(FetchError, match="private or reserved"):
        fetch_feed(url(port, "/to-internal"), policy())


def test_too_many_redirects(port: int) -> None:
    with pytest.raises(FetchError, match="more than 3 times"):
        fetch_feed(url(port, "/loop"), policy())


@pytest.mark.parametrize("path", ["/html", "/type/text_plain", "/type/application_json"])
def test_wrong_content_type_is_refused(port: int, path: str) -> None:
    with pytest.raises(FetchError, match="only RSS, Atom or XML feeds"):
        fetch_feed(url(port, path), policy())


def test_oversized_feed_is_refused(port: int) -> None:
    with pytest.raises(FetchError, match="larger than"):
        fetch_feed(url(port, "/big"), policy(max_bytes=1000))


def test_error_status_is_reported(port: int) -> None:
    with pytest.raises(FetchError, match="status 500"):
        fetch_feed(url(port, "/error"), policy())


@pytest.mark.parametrize(
    ("target", "reason"),
    [
        ("ftp://feeds.example.test/x", "only http and https"),
        ("https://user:pw@feeds.example.test/x", "user name or password"),
        ("http://127.0.0.1/feed", "private or reserved"),
        ("https://nowhere.example.test/feed", "cannot be resolved"),
    ],
)
def test_refused_before_any_connection(target: str, reason: str) -> None:
    with pytest.raises(FetchError, match=reason):
        fetch_feed(target, policy())


def test_default_limits_match_references() -> None:
    default = FetchPolicy()
    assert (default.max_bytes, default.timeout_s, default.max_redirects) == (
        2 * 1024 * 1024,
        10.0,
        3,
    )
