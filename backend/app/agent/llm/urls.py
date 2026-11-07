"""Base URL checks against server-side request forgery (SSRF).

Only ``local`` configurations may point at loopback or private addresses. For every other
type the URL must use https and every address the host resolves to must be global.
DNS rebinding between this check and the connection is a known, accepted gap.
"""

import ipaddress
import socket
from collections.abc import Callable, Sequence
from typing import Any
from urllib.parse import urlsplit

from app.agent.llm.params import PROVIDER_TYPES

Resolver = Callable[..., Sequence[tuple[Any, ...]]]

PRIVATE_ONLY_FOR_LOCAL = "private and link-local addresses are only allowed for Local"


def _addresses(host: str, port: int, resolve: Resolver) -> list[str]:
    try:
        return [str(ipaddress.ip_address(host))]
    except ValueError:
        pass
    try:
        infos = resolve(host, port, 0, socket.SOCK_STREAM)
    except (OSError, UnicodeError) as exc:
        raise ValueError(f"the host '{host}' cannot be resolved") from exc
    addresses = [str(info[4][0]) for info in infos]
    if not addresses:
        raise ValueError(f"the host '{host}' cannot be resolved")
    return addresses


def validate_base_url(provider_type: str, url: str, resolve: Resolver = socket.getaddrinfo) -> str:
    """The normalized URL, or ValueError with a message for the user."""
    url = url.strip()
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise ValueError("the URL is not valid") from exc
    if parts.scheme not in ("http", "https"):
        raise ValueError("the URL must start with http:// or https://")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise ValueError("the URL must not contain a user name or password")
    host = parts.hostname
    if not host:
        raise ValueError("the URL has no host")
    if any(c.isspace() for c in url):
        raise ValueError("the URL must not contain spaces")
    if provider_type == "local":
        return url
    info = PROVIDER_TYPES.get(provider_type)
    if info is not None and info.default_base_url is not None and url == info.default_base_url:
        # The vendor's own endpoint: no lookup needed.
        return url
    for address in _addresses(host, port or (443 if parts.scheme == "https" else 80), resolve):
        ip: ipaddress.IPv4Address | ipaddress.IPv6Address
        ip = ipaddress.ip_address(address.split("%", 1)[0])
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        if not ip.is_global or ip.is_multicast:
            raise ValueError(f"'{host}' is a private or reserved address; {PRIVATE_ONLY_FOR_LOCAL}")
    if parts.scheme != "https":
        raise ValueError("the URL must use https (http is only allowed for Local)")
    return url
