"""Refresh the AI news: read every feed (4 at a time), then store the items in one transaction.

Feeds are fetched with the reference rules (``fetch_feed``) and parsed with ``parse_feed``. A
failing source records its reason and the others are still stored. Items are upserted by URL
and items published more than 90 days ago are removed.
"""

import logging
import threading
import uuid
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from app.db import NewsItem
from app.news.feeds import FeedError, FeedItem, parse_feed
from app.news.sources import NewsSource
from app.resources.fetch import FetchError, FetchPolicy, fetch_feed

WORKERS = 4
KEEP_DAYS = 90
CHUNK = 500

Fetcher = Callable[[str], str]
RefreshState = Literal["idle", "running", "done", "failed"]

log = logging.getLogger(__name__)


def default_fetcher(url: str) -> str:
    return fetch_feed(url, FetchPolicy())


def keep_after(now: datetime) -> datetime:
    return now - timedelta(days=KEEP_DAYS)


@dataclass
class SourceResult:
    id: str
    name: str
    ok: bool | None = None  # None: not read yet in the running job
    items: int | None = None
    error: str | None = None
    fetched_at: datetime | None = None


@dataclass
class RefreshJob:
    state: RefreshState = "idle"
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    sources: list[SourceResult] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _copy(job: RefreshJob) -> RefreshJob:
    return RefreshJob(
        state=job.state,
        started_at=job.started_at,
        finished_at=job.finished_at,
        error=job.error,
        sources=[SourceResult(**asdict(s)) for s in job.sources],
    )


def store_items(
    session: Session,
    batches: Sequence[tuple[str, Sequence[FeedItem]]],
    fetched_at: datetime,
) -> None:
    """Upsert by URL (first source wins for a URL) and remove items older than 90 days."""
    cutoff = keep_after(fetched_at)
    rows: dict[str, dict[str, Any]] = {}
    for source_id, items in batches:
        for item in items:
            if item.url in rows or item.published_at < cutoff:
                continue
            rows[item.url] = {
                "id": uuid.uuid4(),
                "source": source_id,
                "title": item.title,
                "url": item.url,
                "published_at": item.published_at,
                "summary": item.summary,
                "fetched_at": fetched_at,
            }
    values = list(rows.values())
    try:
        for start in range(0, len(values), CHUNK):
            statement = insert(NewsItem).values(values[start : start + CHUNK])
            statement = statement.on_conflict_do_update(
                constraint="uq_news_items_url",
                set_={
                    "title": statement.excluded.title,
                    "summary": statement.excluded.summary,
                    "published_at": statement.excluded.published_at,
                    "fetched_at": statement.excluded.fetched_at,
                },
            )
            session.execute(statement)
        session.execute(delete(NewsItem).where(NewsItem.published_at < cutoff))
        session.commit()
    except Exception:
        session.rollback()
        raise


@dataclass
class NewsJobs:
    """The news refresh status (in memory); at most one running refresh."""

    _job: RefreshJob = field(default_factory=RefreshJob)
    # The latest result of each source, kept across jobs.
    _last: dict[str, SourceResult] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def status(self) -> RefreshJob:
        with self._lock:
            return _copy(self._job)

    def last_results(self) -> dict[str, SourceResult]:
        with self._lock:
            return {k: SourceResult(**asdict(v)) for k, v in self._last.items()}

    def last_refresh_at(self) -> datetime | None:
        with self._lock:
            job = self._job
            return job.finished_at if job.state in ("done", "failed") else None

    def start(self, sources: Sequence[NewsSource]) -> tuple[RefreshJob, bool]:
        """The job and whether it was started now (False: one is already running)."""
        with self._lock:
            if self._job.state == "running":
                return _copy(self._job), False
            self._job = RefreshJob(
                state="running",
                started_at=datetime.now(UTC),
                sources=[SourceResult(id=s.id, name=s.name) for s in sources],
            )
            return _copy(self._job), True

    def _record(self, result: SourceResult) -> None:
        with self._lock:
            for index, current in enumerate(self._job.sources):
                if current.id == result.id:
                    self._job.sources[index] = result
            self._last[result.id] = SourceResult(**asdict(result))

    def _finish(self, state: RefreshState, error: str | None = None) -> None:
        with self._lock:
            self._job.state, self._job.error = state, error
            self._job.finished_at = datetime.now(UTC)

    def _read(self, source: NewsSource, fetch: Fetcher) -> list[FeedItem]:
        """One source's items; its result (ok or the reason) is recorded either way."""
        fetched_at = datetime.now(UTC)
        try:
            items = parse_feed(fetch(source.feed), fetched_at)
        except (FetchError, FeedError) as exc:
            error = str(exc)
        except Exception as exc:
            log.exception("news source %s failed", source.id)
            error = f"unexpected error ({exc.__class__.__name__})"
        else:
            kept = [i for i in items if i.published_at >= keep_after(fetched_at)]
            self._record(SourceResult(source.id, source.name, True, len(kept), None, fetched_at))
            return items
        self._record(SourceResult(source.id, source.name, False, 0, error, fetched_at))
        raise _SourceFailed

    def run(
        self,
        sources: Sequence[NewsSource],
        sessions: sessionmaker[Session],
        fetch: Fetcher = default_fetcher,
    ) -> None:
        """Body of a started job: records done or failed, never raises."""
        try:

            def read(source: NewsSource) -> tuple[str, list[FeedItem]] | None:
                try:
                    return source.id, self._read(source, fetch)
                except _SourceFailed:
                    return None

            with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                results = list(pool.map(read, sources))
            batches = [r for r in results if r is not None]
            if sources and not batches:
                self._finish("failed", "every source failed")
                return
            with sessions() as session:
                store_items(session, batches, datetime.now(UTC))
        except Exception as exc:
            log.exception("news refresh failed")
            self._finish("failed", f"unexpected error ({exc.__class__.__name__})")
        else:
            self._finish("done")


class _SourceFailed(Exception):
    """Internal: a source failed and its result is already recorded."""
