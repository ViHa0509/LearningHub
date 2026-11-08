"""Sync a domain's reference links from roadmap.sh's repository at a pinned commit.

One tree listing, then the mapped node files (4 at a time). Only link lines are parsed. The
domain's rows are replaced in one transaction at the end, so a failed sync keeps the old rows.
"""

import json
import logging
import re
import threading
import urllib.error
import urllib.request
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import delete
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db import NodeResource
from app.resources.mapping import COMMIT, ResourceMapping
from app.resources.parser import parse_links

REPO = "kamranahmedse/developer-roadmap"
SOURCE = "roadmap.sh"
WORKERS = 4
TIMEOUT_S = 20.0
MAX_BYTES = 20 * 1024 * 1024
USER_AGENT = "LearningHub/0.1 (personal study app)"
CONTENT_FILE = re.compile(r"^roadmaps/([a-z0-9-]+)/content/([a-z0-9-]+)@([^/]+)\.md$")

Getter = Callable[[str, float], bytes]
SyncState = Literal["idle", "running", "done", "failed"]

log = logging.getLogger(__name__)


class SyncError(Exception):
    """The sync failed; the message is safe to show and names the cause."""


@dataclass(frozen=True)
class SyncResult:
    commit: str
    nodes: int
    links: int


def http_get(url: str, timeout: float) -> bytes:
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json, */*"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data: bytes = response.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        raise SyncError(f"the source answered {exc.code} for {_short(url)}") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise SyncError(f"the source could not be reached for {_short(url)}") from exc
    if len(data) > MAX_BYTES:
        raise SyncError(f"the answer for {_short(url)} is too large")
    return data


def _short(url: str) -> str:
    """The path after the commit (or the URL path), for error messages."""
    marker = "/roadmaps/"
    return url[url.index(marker) + 1 :] if marker in url else url.split("://", 1)[-1]


def tree_index(listing: bytes) -> dict[str, dict[str, list[str]]]:
    """roadmap -> slug -> file names, from a git tree listing."""
    try:
        data = json.loads(listing)
        entries = data["tree"]
    except (ValueError, KeyError, TypeError) as exc:
        raise SyncError("the tree listing is not valid") from exc
    if data.get("truncated"):
        raise SyncError("the tree listing is truncated")
    index: dict[str, dict[str, list[str]]] = {}
    for entry in entries:
        path = entry.get("path") if isinstance(entry, dict) else None
        if not isinstance(path, str):
            continue
        match = CONTENT_FILE.match(path)
        if match is None or entry.get("type", "blob") != "blob":
            continue
        roadmap, slug = match.group(1), match.group(2)
        index.setdefault(roadmap, {}).setdefault(slug, []).append(path.rsplit("/", 1)[1])
    for slugs in index.values():
        for files in slugs.values():
            files.sort()
    return index


def _plan(
    mapping: ResourceMapping, index: dict[str, dict[str, list[str]]], commit: str
) -> list[tuple[str, str, str]]:
    """(node_id, roadmap, file name) in mapping order; SyncError names an unknown ref."""
    plan: list[tuple[str, str, str]] = []
    for node_id, refs in mapping.nodes.items():
        for ref in refs:
            slugs = index.get(ref.roadmap)
            if slugs is None:
                raise SyncError(f"unknown roadmap '{ref.roadmap}' at commit {commit} ({node_id})")
            if ref.slug == "*":
                names = [name for slug in sorted(slugs) for name in slugs[slug]]
            elif ref.slug in slugs:
                names = slugs[ref.slug]
            else:
                raise SyncError(f"unknown slug '{ref}' at commit {commit} ({node_id})")
            plan.extend((node_id, ref.roadmap, name) for name in names)
    return plan


def collect(
    mapping: ResourceMapping,
    settings: Settings,
    commit: str | None = None,
    get: Getter = http_get,
) -> tuple[str, list[NodeResource]]:
    """Fetch and parse the domain's links; nothing is written. SyncError on any failure."""
    commit = commit or mapping.commit
    if not COMMIT.match(commit):
        raise SyncError(f"'{commit}' is not a git commit id")
    api = settings.roadmap_api_base.rstrip("/")
    raw = settings.roadmap_raw_base.rstrip("/")
    index = tree_index(get(f"{api}/repos/{REPO}/git/trees/{commit}?recursive=1", TIMEOUT_S))
    plan = _plan(mapping, index, commit)

    files = sorted({(roadmap, name) for _, roadmap, name in plan})

    def fetch(item: tuple[str, str]) -> str:
        roadmap, name = item
        data = get(f"{raw}/{REPO}/{commit}/roadmaps/{roadmap}/content/{name}", TIMEOUT_S)
        return data.decode("utf-8", errors="replace")

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        texts = dict(zip(files, pool.map(fetch, files), strict=True))

    rows: list[NodeResource] = []
    seen: set[tuple[str, str]] = set()
    for node_id, roadmap, name in plan:
        for link in parse_links(texts[(roadmap, name)]):
            if (node_id, link.url) in seen:
                continue
            seen.add((node_id, link.url))
            rows.append(
                NodeResource(
                    node_id=node_id,
                    url=link.url,
                    title=link.label,
                    type=link.type,
                    source=SOURCE,
                    source_ref=f"{roadmap}/{name.removesuffix('.md')}",
                    commit=commit,
                )
            )
    return commit, rows


def replace_rows(session: Session, domain: str, rows: list[NodeResource]) -> None:
    """Replace the domain's synced rows in one transaction."""
    try:
        session.execute(
            delete(NodeResource).where(
                NodeResource.node_id.like(f"{domain}/%"), NodeResource.source == SOURCE
            )
        )
        session.add_all(rows)
        session.commit()
    except Exception:
        session.rollback()
        raise


def sync_domain(
    mapping: ResourceMapping,
    settings: Settings,
    sessions: sessionmaker[Session],
    commit: str | None = None,
    get: Getter = http_get,
) -> SyncResult:
    used, rows = collect(mapping, settings, commit, get)
    with sessions() as session:
        replace_rows(session, mapping.domain, rows)
    return SyncResult(commit=used, nodes=len({r.node_id for r in rows}), links=len(rows))


@dataclass
class SyncJob:
    domain: str
    state: SyncState = "idle"
    commit: str | None = None
    nodes: int | None = None
    links: int | None = None
    error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SyncJobs:
    """In-memory sync status per domain; at most one running job per domain."""

    _jobs: dict[str, SyncJob] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def status(self, domain: str) -> SyncJob:
        with self._lock:
            job = self._jobs.get(domain)
            return SyncJob(**asdict(job)) if job else SyncJob(domain=domain)

    def start(self, domain: str, commit: str) -> tuple[SyncJob, bool]:
        """The job and whether it was started now (False: one is already running)."""
        with self._lock:
            job = self._jobs.get(domain)
            if job is not None and job.state == "running":
                return SyncJob(**asdict(job)), False
            job = SyncJob(domain, "running", commit, started_at=datetime.now(UTC))
            self._jobs[domain] = job
            return SyncJob(**asdict(job)), True

    def finish(self, domain: str, result: SyncResult) -> None:
        with self._lock:
            job = self._jobs[domain]
            job.state, job.commit = "done", result.commit
            job.nodes, job.links, job.error = result.nodes, result.links, None
            job.finished_at = datetime.now(UTC)

    def fail(self, domain: str, error: str) -> None:
        with self._lock:
            job = self._jobs[domain]
            job.state, job.error = "failed", error
            job.finished_at = datetime.now(UTC)

    def run(
        self,
        mapping: ResourceMapping,
        settings: Settings,
        sessions: sessionmaker[Session],
        get: Getter = http_get,
    ) -> None:
        """Body of a started job: records done or failed, never raises."""
        try:
            result = sync_domain(mapping, settings, sessions, get=get)
        except SyncError as exc:
            self.fail(mapping.domain, str(exc))
        except Exception as exc:
            log.exception("resource sync of %s failed", mapping.domain)
            self.fail(mapping.domain, f"unexpected error ({exc.__class__.__name__})")
        else:
            self.finish(mapping.domain, result)
