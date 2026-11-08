"""Fetch one reference page for the agent, safely (server-side request forgery is the risk).

Rules: http(s) only, no user info in the URL, never YouTube; every hop (the URL and each of at
most 3 redirects) is resolved and every address must be global; the connection goes to the
address that was checked (no second lookup that DNS rebinding could change); at most 2 MB in
10 s, and only text/html or text/plain. Nothing is stored and no cookies are sent.
"""

import http.client
import ipaddress
import socket
import ssl
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin, urlsplit

from app.extract import extract

Resolver = Callable[..., Sequence[tuple[Any, ...]]]
IpCheck = Callable[[str], bool]

REDIRECTS = {301, 302, 303, 307, 308}
TEXT_TYPES = ("text/html", "text/plain")
BLOCKED_HOSTS = ("youtube.com", "youtu.be")
USER_AGENT = "LearningHub/0.1 (personal study app)"


class FetchError(Exception):
    """The page was not fetched; the message is safe to show to the model."""


def is_global_address(address: str) -> bool:
    ip: ipaddress.IPv4Address | ipaddress.IPv6Address
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def is_youtube(host: str) -> bool:
    host = host.lower().rstrip(".")
    return any(host == h or host.endswith("." + h) for h in BLOCKED_HOSTS)


@dataclass
class FetchPolicy:
    timeout_s: float = 10.0
    max_bytes: int = 2 * 1024 * 1024
    max_redirects: int = 3
    max_chars: int = 20_000
    resolve: Resolver = socket.getaddrinfo
    # Tests swap this to reach a fake server; production keeps global addresses only.
    allowed: IpCheck = field(default=is_global_address)


@dataclass
class Fetched:
    url: str
    text: str
    truncated: bool


class _PinnedHTTP(http.client.HTTPConnection):
    def __init__(self, host: str, port: int, address: str, timeout: float) -> None:
        super().__init__(host, port, timeout=timeout)
        self._address = address

    def connect(self) -> None:
        self.sock = socket.create_connection((self._address, self.port), self.timeout)


class _PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host: str, port: int, address: str, timeout: float) -> None:
        super().__init__(host, port, timeout=timeout)
        self._address = address
        self._tls = ssl.create_default_context()

    def connect(self) -> None:
        sock = socket.create_connection((self._address, self.port), self.timeout)
        # The certificate is checked against the host name, not the address.
        self.sock = self._tls.wrap_socket(sock, server_hostname=self.host)


def _checked_address(url: str, policy: FetchPolicy) -> tuple[str, str, int, str]:
    """Scheme, host, port and the one address to connect to; FetchError if not allowed."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise FetchError("the URL is not valid") from exc
    if parts.scheme not in ("http", "https"):
        raise FetchError("only http and https URLs can be fetched")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise FetchError("URLs with a user name or password are not fetched")
    host = parts.hostname
    if not host:
        raise FetchError("the URL has no host")
    if is_youtube(host):
        raise FetchError("videos are not fetched; open the link instead")
    port = port or (443 if parts.scheme == "https" else 80)
    try:
        infos = policy.resolve(host, port, 0, socket.SOCK_STREAM)
    except (OSError, UnicodeError) as exc:
        raise FetchError(f"the host '{host}' cannot be resolved") from exc
    addresses = [str(info[4][0]) for info in infos]
    if not addresses:
        raise FetchError(f"the host '{host}' cannot be resolved")
    # Every address must pass: a host that also resolves to an internal address is refused.
    if not all(policy.allowed(a) for a in addresses):
        raise FetchError(f"'{host}' points to a private or reserved address")
    return parts.scheme, host, port, addresses[0]


def _request(url: str, policy: FetchPolicy, deadline: float) -> http.client.HTTPResponse:
    scheme, host, port, address = _checked_address(url, policy)
    remaining = max(0.1, deadline - time.monotonic())
    conn: http.client.HTTPConnection
    if scheme == "https":
        conn = _PinnedHTTPS(host, port, address, remaining)
    else:
        conn = _PinnedHTTP(host, port, address, remaining)
    parts = urlsplit(url)
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    try:
        conn.request(
            "GET",
            path,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html, text/plain"},
        )
        return conn.getresponse()
    except (OSError, http.client.HTTPException) as exc:
        conn.close()
        raise FetchError(f"the page could not be fetched ({exc.__class__.__name__})") from exc


def _read_capped(response: http.client.HTTPResponse, policy: FetchPolicy, deadline: float) -> bytes:
    length = response.getheader("Content-Length")
    if length and length.isdigit() and int(length) > policy.max_bytes:
        raise FetchError(f"the page is larger than {policy.max_bytes // (1024 * 1024)} MB")
    chunks: list[bytes] = []
    size = 0
    while True:
        if time.monotonic() > deadline:
            raise FetchError(f"the page took longer than {policy.timeout_s:g} s")
        try:
            chunk = response.read(64 * 1024)
        except (OSError, http.client.HTTPException) as exc:
            raise FetchError("the page could not be read") from exc
        if not chunk:
            return b"".join(chunks)
        size += len(chunk)
        if size > policy.max_bytes:
            raise FetchError(f"the page is larger than {policy.max_bytes // (1024 * 1024)} MB")
        chunks.append(chunk)


def _charset(content_type: str) -> str:
    for part in content_type.split(";")[1:]:
        key, _, value = part.strip().partition("=")
        if key.lower() == "charset" and value:
            return value.strip("\"'")
    return "utf-8"


def fetch_text(url: str, policy: FetchPolicy | None = None) -> Fetched:
    """Readable text of one page; FetchError (safe message) when it is refused or fails."""
    policy = policy or FetchPolicy()
    deadline = time.monotonic() + policy.timeout_s
    current = url
    for _ in range(policy.max_redirects + 1):
        response = _request(current, policy, deadline)
        try:
            if response.status in REDIRECTS:
                location = response.getheader("Location")
                if not location:
                    raise FetchError("the page redirects without a location")
                current = urljoin(current, location)
                continue
            if response.status != 200:
                raise FetchError(f"the page answered with status {response.status}")
            content_type = response.getheader("Content-Type") or ""
            media = content_type.split(";", 1)[0].strip().lower()
            if media not in TEXT_TYPES:
                raise FetchError(f"only HTML or plain text pages are read, not '{media or '?'}'")
            data = _read_capped(response, policy, deadline)
        finally:
            response.close()
        try:
            raw = data.decode(_charset(content_type), errors="replace")
        except LookupError:
            raw = data.decode("utf-8", errors="replace")
        text = extract(raw, "page.html").text if media == "text/html" else raw
        truncated = len(text) > policy.max_chars
        return Fetched(url=current, text=text[: policy.max_chars], truncated=truncated)
    raise FetchError(f"the page redirects more than {policy.max_redirects} times")
