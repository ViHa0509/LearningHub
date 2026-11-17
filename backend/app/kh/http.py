"""The one place the connector touches the network; tests replace it with a fake."""

import json
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

HTTP_TIMEOUT = 10
MAX_BODY = 1_000_000


class KhNetworkError(Exception):
    """The identity service or KH could not be reached, or answered nonsense."""


@dataclass(frozen=True)
class HttpRequest:
    method: str
    url: str
    form: dict[str, str] | None = None
    json_body: dict[str, Any] | None = None
    bearer: str | None = None


@dataclass(frozen=True)
class HttpReply:
    status: int
    body: Any  # parsed JSON, or None when the answer was not JSON


HttpFn = Callable[[HttpRequest], HttpReply]


def _parse(raw: bytes) -> Any:
    try:
        return json.loads(raw)
    except ValueError:
        return None


def urllib_http(request: HttpRequest) -> HttpReply:
    """Send the request (10 s timeout, 1 MB answer limit). HTTP error statuses are replies."""
    headers = {"Accept": "application/json", "User-Agent": "learning-hub"}
    data = None
    if request.form is not None:
        data = urllib.parse.urlencode(request.form).encode("ascii")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif request.json_body is not None:
        data = json.dumps(request.json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if request.bearer is not None:
        headers["Authorization"] = f"Bearer {request.bearer}"
    if not request.url.lower().startswith(("https://", "http://")):
        raise KhNetworkError("unsupported address")
    outgoing = urllib.request.Request(
        request.url, data=data, headers=headers, method=request.method
    )
    try:
        with urllib.request.urlopen(outgoing, timeout=HTTP_TIMEOUT) as response:
            return HttpReply(response.status, _parse(response.read(MAX_BODY)))
    except urllib.error.HTTPError as error:
        try:
            return HttpReply(error.code, _parse(error.read(MAX_BODY)))
        finally:
            error.close()
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
        raise KhNetworkError(type(error).__name__) from None
