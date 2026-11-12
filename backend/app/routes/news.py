"""AI news: the refresh job and the stored items."""

import threading
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, sessionmaker

from app.db import NewsItem, get_session
from app.job_status import load_status, save_status
from app.news.refresh import Fetcher, NewsJobs, RefreshJob
from app.news.sources import NewsSource
from app.routes.guard import require_app_header
from app.schemas import (
    NewsItemOut,
    NewsListOut,
    NewsRefreshStatus,
    NewsSourceOut,
    NewsSourceResult,
)

router = APIRouter(prefix="/api/news", tags=["news"])

STALE_AFTER = timedelta(hours=1)
JOB_KEY = "job.news"


def _sources(request: Request) -> Sequence[NewsSource]:
    sources: Sequence[NewsSource] = request.app.state.news_sources
    return sources


def _jobs(request: Request) -> NewsJobs:
    jobs: NewsJobs = request.app.state.news_jobs
    return jobs


def _serverless(request: Request) -> bool:
    serverless: bool = request.app.state.settings.serverless
    return serverless


def _saved_job(request: Request, session: Session) -> RefreshJob | None:
    """In serverless mode the last finished refresh, as saved in the database."""
    return load_status(session, JOB_KEY, RefreshJob) if _serverless(request) else None


def _status(job: RefreshJob) -> NewsRefreshStatus:
    return NewsRefreshStatus(
        state=job.state,
        started_at=job.started_at,
        finished_at=job.finished_at,
        error=job.error,
        sources=[
            NewsSourceResult(id=s.id, name=s.name, ok=s.ok, items=s.items, error=s.error)
            for s in job.sources
        ],
    )


@router.post(
    "/refresh",
    status_code=202,
    response_model=NewsRefreshStatus,
    dependencies=[Depends(require_app_header)],
)
def start_refresh(request: Request) -> NewsRefreshStatus:
    """Starts a background refresh of every source; while one runs, answers that one."""
    jobs = _jobs(request)
    sources = _sources(request)
    job, started = jobs.start(sources)
    if started:
        sessions: sessionmaker[Session] = request.app.state.session_factory
        fetcher: Fetcher = request.app.state.news_fetcher
        if _serverless(request):
            # No thread outlives the answer there: run now and save the final status, which
            # another instance may be asked for.
            jobs.run(sources, sessions, fetcher)
            job = jobs.status()
            save_status(sessions, JOB_KEY, RefreshJob, job)
        else:
            threading.Thread(
                target=jobs.run, args=(sources, sessions, fetcher), name="news-refresh", daemon=True
            ).start()
    return _status(job)


@router.get("/refresh", response_model=NewsRefreshStatus)
def refresh_status(
    request: Request, session: Annotated[Session, Depends(get_session)]
) -> NewsRefreshStatus:
    saved = _saved_job(request, session)
    return _status(saved if saved is not None else _jobs(request).status())


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("", response_model=NewsListOut)
def list_news(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    source: str | None = None,
    q: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    before: datetime | None = None,
) -> NewsListOut:
    """Items newest first (filtered by source and text, paged with ``before``) and the sources
    with their item count and last fetch result."""
    sources = _sources(request)
    names = {s.id: s.name for s in sources}

    query = select(NewsItem)
    if source:
        query = query.where(NewsItem.source == source)
    text = (q or "").strip()
    if text:
        pattern = f"%{_escape_like(text)}%"
        query = query.where(
            or_(
                NewsItem.title.ilike(pattern, escape="\\"),
                NewsItem.summary.ilike(pattern, escape="\\"),
            )
        )
    if before is not None:
        if before.tzinfo is None:
            before = before.replace(tzinfo=UTC)
        query = query.where(NewsItem.published_at < before)
    query = query.order_by(NewsItem.published_at.desc(), NewsItem.id.desc()).limit(limit)
    rows = session.scalars(query).all()

    count_rows = session.execute(
        select(NewsItem.source, func.count()).group_by(NewsItem.source)
    ).all()
    counts: dict[str, int] = {source_id: count for source_id, count in count_rows}
    stored_at = session.scalar(select(func.max(NewsItem.fetched_at)))
    jobs = _jobs(request)
    saved = _saved_job(request, session)
    if saved is not None:
        last = {s.id: s for s in saved.sources}
        finished_at = saved.finished_at
    else:
        last, finished_at = jobs.last_results(), jobs.last_refresh_at()
    refreshed = [t for t in (finished_at, stored_at) if t is not None]
    last_refresh_at = max(refreshed) if refreshed else None
    stale = last_refresh_at is None or datetime.now(UTC) - last_refresh_at > STALE_AFTER

    return NewsListOut(
        items=[
            NewsItemOut(
                id=r.id,
                source=r.source,
                source_name=names.get(r.source, r.source),
                title=r.title,
                url=r.url,
                published_at=r.published_at,
                summary=r.summary,
            )
            for r in rows
        ],
        sources=[
            NewsSourceOut(
                id=s.id,
                name=s.name,
                homepage=s.homepage,
                count=counts.get(s.id, 0),
                last_ok=last[s.id].ok if s.id in last else None,
                last_error=last[s.id].error if s.id in last else None,
                last_fetched_at=last[s.id].fetched_at if s.id in last else None,
            )
            for s in sources
        ],
        last_refresh_at=last_refresh_at,
        stale=stale,
    )
