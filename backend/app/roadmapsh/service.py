"""Read roadmap.sh's official roadmaps at question time (design 2).

Hosts come from settings only; the model supplies a slug and a node id, both validated before
any request. Results stay in a short in-memory cache and are never written to the database or
disk (the content is for personal use only).
"""

import json
import re
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.config import Settings
from app.resources.sync import REPO, USER_AGENT

SLUG = re.compile(r"^[a-z0-9-]{1,60}$")
NODE_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
# Any name before the last '@' (also empty or '_atomic'); looser than the sync's pattern.
CONTENT_FILE = re.compile(r"^roadmaps/([a-z0-9-]+)/content/[^/]*@([A-Za-z0-9_-]+)\.md$")
TIMEOUT_S = 10.0
TREE_LIMIT = 20 * 1024 * 1024
OUTLINE_LIMIT = 5 * 1024 * 1024
TOPIC_LIMIT = 200 * 1024
CACHE_S = 3600.0
MAX_ITEMS = 400
ROADMAPSH = "roadmap.sh"
GITHUB = "GitHub"

# url, timeout, headers, body limit -> body; raises HttpFailed.
Get = Callable[[str, float, dict[str, str], int], bytes]


class HttpFailed(Exception):
    """An HTTP error (status), or no answer: network error, timeout, too large (status None)."""

    def __init__(self, status: int | None) -> None:
        super().__init__(status)
        self.status = status


class BadInput(Exception):
    """A slug or node id refused before any request; the message is safe to show."""


class NotFound(Exception):
    """The roadmap or topic does not exist; the message is safe to show."""


class SourceError(Exception):
    """roadmap.sh or GitHub failed; the message is safe to show."""

    def __init__(self, source: str, status: int | None, message: str | None = None) -> None:
        text = message or (
            f"{source} did not answer" if status is None else f"{source} answered {status}"
        )
        super().__init__(text)
        self.source = source
        self.status = status


def http_get(url: str, timeout: float, headers: dict[str, str], limit: int) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **headers})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data: bytes = response.read(limit + 1)
    except urllib.error.HTTPError as exc:
        raise HttpFailed(exc.code) from exc
    except (urllib.error.URLError, OSError) as exc:  # TimeoutError is an OSError
        raise HttpFailed(None) from exc
    if len(data) > limit:
        raise HttpFailed(None)
    return data


@dataclass(frozen=True)
class OutlineItem:
    kind: str  # topic | subtopic
    label: str
    node_id: str


@dataclass(frozen=True)
class Outline:
    slug: str
    title: str
    type: str
    description: str
    items: tuple[OutlineItem, ...]
    truncated: bool


def check_slug(slug: str) -> None:
    if not SLUG.match(slug):
        raise BadInput("'slug' must be a roadmap.sh slug (lowercase letters, digits and '-')")


def check_node_id(node_id: str) -> None:
    if not NODE_ID.match(node_id):
        raise BadInput("'node_id' must be a node id (letters, digits, '_' and '-')")


def _number(value: Any) -> float:
    return float(value) if isinstance(value, int | float) else 0.0


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def content_index(listing: bytes) -> dict[str, dict[str, str]]:
    """slug -> node id -> path, from every ``roadmaps/<slug>/content/<name>@<nodeId>.md``."""
    try:
        data = json.loads(listing)
        entries = data["tree"]
        if not isinstance(entries, list) or data.get("truncated"):
            raise TypeError("no complete tree")
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise SourceError(GITHUB, None, "GitHub answered an invalid listing") from exc
    tree: dict[str, dict[str, str]] = {}
    for entry in entries:
        path = entry.get("path") if isinstance(entry, dict) else None
        match = CONTENT_FILE.match(path) if isinstance(path, str) else None
        if match is not None and entry.get("type", "blob") == "blob":
            tree.setdefault(match.group(1), {})[match.group(2)] = match.group(0)
    return tree


class RoadmapExplorer:
    """Built from settings; tests inject ``get`` and ``clock``."""

    def __init__(
        self,
        settings: Settings,
        get: Get = http_get,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._api = settings.roadmapsh_api_base.rstrip("/")
        self._github = settings.roadmap_api_base.rstrip("/")
        self._raw = settings.roadmap_raw_base.rstrip("/")
        self._ref = settings.roadmapsh_ref
        self._get = get
        self._clock = clock
        # Public data, shared by all users; at most one hour old.
        self._tree: tuple[float, dict[str, dict[str, str]]] | None = None
        self._outlines: dict[str, tuple[float, Outline]] = {}

    def _fetch(self, url: str, source: str, limit: int, headers: dict[str, str]) -> bytes:
        try:
            return self._get(url, TIMEOUT_S, headers, limit)
        except HttpFailed as exc:
            if exc.status == 404:
                raise NotFound(url) from exc
            raise SourceError(source, exc.status) from exc

    def tree(self, token: str | None) -> dict[str, dict[str, str]]:
        """slug -> node id -> file path in the repository."""
        now = self._clock()
        if self._tree is not None and self._tree[0] > now:
            return self._tree[1]
        headers = {"Accept": "application/vnd.github+json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        url = f"{self._github}/repos/{REPO}/git/trees/{self._ref}?recursive=1"
        try:
            tree = content_index(self._fetch(url, GITHUB, TREE_LIMIT, headers))
        except NotFound as exc:
            raise SourceError(GITHUB, 404) from exc
        self._tree = (now + CACHE_S, tree)
        return tree

    def outline(self, slug: str) -> Outline:
        check_slug(slug)
        now = self._clock()
        cached = self._outlines.get(slug)
        if cached is not None and cached[0] > now:
            return cached[1]
        url = f"{self._api}/v1-official-roadmap/{slug}"
        try:
            body = self._fetch(url, ROADMAPSH, OUTLINE_LIMIT, {"Accept": "application/json"})
        except NotFound as exc:
            raise NotFound(f"roadmap.sh has no roadmap '{slug}'") from exc
        try:
            data = json.loads(body)
            nodes = data["nodes"]
            if not isinstance(nodes, list):
                raise TypeError("nodes is not a list")
        except (ValueError, KeyError, TypeError) as exc:
            raise SourceError(ROADMAPSH, None, "roadmap.sh answered an invalid roadmap") from exc
        found: list[tuple[float, float, OutlineItem]] = []
        for node in nodes:
            if not isinstance(node, dict) or node.get("type") not in ("topic", "subtopic"):
                continue
            node_data = node.get("data")
            label = node_data.get("label") if isinstance(node_data, dict) else None
            node_id = node.get("id")
            if not isinstance(label, str) or not label.strip() or not isinstance(node_id, str):
                continue
            position = node.get("position")
            if not isinstance(position, dict):
                position = {}
            item = OutlineItem(node["type"], " ".join(label.split()), node_id)
            found.append((_number(position.get("y")), _number(position.get("x")), item))
        found.sort(key=lambda entry: (entry[0], entry[1]))
        title = data.get("title")
        if isinstance(title, dict):
            title = title.get("page") or title.get("card")
        outline = Outline(
            slug=slug,
            title=_text(title),
            type=_text(data.get("type")),
            description=_text(data.get("description")),
            items=tuple(entry[2] for entry in found[:MAX_ITEMS]),
            truncated=len(found) > MAX_ITEMS,
        )
        self._outlines[slug] = (now + CACHE_S, outline)
        return outline

    def topic(self, slug: str, node_id: str, token: str | None) -> str:
        """The topic file's text; not cached."""
        check_slug(slug)
        check_node_id(node_id)
        topics = self.tree(token).get(slug)
        if topics is None:
            raise NotFound(f"roadmap.sh has no roadmap '{slug}'")
        missing = f"roadmap '{slug}' has no topic '{node_id}'"
        path = topics.get(node_id)
        if path is None:
            raise NotFound(missing)
        url = f"{self._raw}/{REPO}/{self._ref}/{path}"
        try:
            return self._fetch(url, GITHUB, TOPIC_LIMIT, {}).decode("utf-8", errors="replace")
        except NotFound as exc:
            raise NotFound(missing) from exc
