"""News sources from ``news/sources.yaml``: id, name, homepage and RSS/Atom feed URL.

The file is checked at startup; an invalid one stops the server and names the problem, like an
invalid roadmap file.
"""

import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import yaml

from app.roadmaps import RoadmapError

SOURCE_ID = re.compile(r"^[a-z0-9-]+$")


class NewsSourcesError(RoadmapError):
    """The news sources file is invalid; the message names the file and the source."""


@dataclass(frozen=True)
class NewsSource:
    id: str
    name: str
    homepage: str
    feed: str


def _fail(path: Path, message: str) -> NewsSourcesError:
    return NewsSourcesError(f"news/{path.name}: {message}")


def _is_https(url: object) -> bool:
    if not isinstance(url, str):
        return False
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme == "https" and bool(parts.hostname) and "@" not in parts.netloc


def load_sources(path: Path) -> tuple[NewsSource, ...]:
    """The sources in file order; NewsSourcesError if the file is missing or invalid."""
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise _fail(path, f"cannot be read ({exc.__class__.__name__})") from exc
    except yaml.YAMLError as exc:
        raise _fail(path, f"invalid YAML ({exc})") from exc
    raw = data.get("sources") if isinstance(data, dict) else None
    if not isinstance(raw, list) or not raw:
        raise _fail(path, "top level must be a mapping with a non-empty 'sources' list")
    sources: list[NewsSource] = []
    seen: set[str] = set()
    for position, entry in enumerate(raw, start=1):
        if not isinstance(entry, dict):
            raise _fail(path, f"source #{position} must be a mapping")
        source_id = entry.get("id")
        if not isinstance(source_id, str) or not SOURCE_ID.match(source_id):
            raise _fail(path, f"source #{position} has an invalid id '{source_id}'")
        if source_id in seen:
            raise _fail(path, f"duplicate source id '{source_id}'")
        seen.add(source_id)
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            raise _fail(path, f"source '{source_id}' has no name")
        for key in ("homepage", "feed"):
            if not _is_https(entry.get(key)):
                raise _fail(path, f"source '{source_id}': {key} must be an https URL")
        sources.append(
            NewsSource(
                id=source_id, name=name.strip(), homepage=entry["homepage"], feed=entry["feed"]
            )
        )
    return tuple(sources)
