"""References of roadmap nodes (links synced from roadmap.sh) and the sync job."""

import threading
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db import get_session
from app.job_status import load_status, save_status
from app.learning.catalog import UserCatalog
from app.resources.mapping import ResourceMapping
from app.resources.store import node_resources
from app.resources.sync import SOURCE, SyncJob, SyncJobs
from app.routes.guard import require_app_header
from app.routes.lessons import require_node
from app.schemas import NodeResourcesOut, ResourceItem, ResourceSyncRequest, ResourceSyncStatus

router = APIRouter(prefix="/api/resources", tags=["resources"])


def _mappings(request: Request) -> dict[str, ResourceMapping]:
    mappings: dict[str, ResourceMapping] = request.app.state.resource_mappings
    return mappings


def _jobs(request: Request) -> SyncJobs:
    jobs: SyncJobs = request.app.state.resource_sync
    return jobs


def _job_key(domain: str) -> str:
    return f"job.resources.{domain}"


def _status(job: SyncJob) -> ResourceSyncStatus:
    return ResourceSyncStatus(**job.as_dict())


def _mapping_of(request: Request, domain: str) -> ResourceMapping:
    mapping = _mappings(request).get(domain)
    if mapping is None:
        raise HTTPException(status_code=404, detail=f"no resource mapping for domain '{domain}'")
    return mapping


# The sync routes come first: "/sync/{domain}" would otherwise match "/{domain}/{node}".
@router.post(
    "/sync",
    status_code=202,
    response_model=ResourceSyncStatus,
    dependencies=[Depends(require_app_header)],
)
def start_sync(payload: ResourceSyncRequest, request: Request) -> ResourceSyncStatus:
    """Starts a background sync of the domain; while one runs, answers that one."""
    mapping = _mapping_of(request, payload.domain)
    jobs = _jobs(request)
    job, started = jobs.start(mapping.domain, mapping.commit)
    if started:
        settings: Settings = request.app.state.settings
        sessions: sessionmaker[Session] = request.app.state.session_factory
        args = (mapping, settings, sessions, request.app.state.resource_getter)
        if settings.serverless:
            # No thread outlives the answer there: run now and save the final status, which
            # another instance may be asked for.
            jobs.run(*args)
            job = jobs.status(mapping.domain)
            save_status(sessions, _job_key(mapping.domain), SyncJob, job)
        else:
            threading.Thread(
                target=jobs.run, args=args, name=f"resource-sync-{mapping.domain}", daemon=True
            ).start()
    return _status(job)


@router.get("/sync/{domain}", response_model=ResourceSyncStatus)
def sync_status(
    domain: str,
    request: Request,
    catalog: UserCatalog,
    session: Annotated[Session, Depends(get_session)],
) -> ResourceSyncStatus:
    """A roadmap without a mapping is "unavailable" (200, so lesson pages log no error);
    a domain that is not in the catalog is 404."""
    if domain not in _mappings(request):
        if not any(d.id == domain for d in catalog.domains()):
            raise HTTPException(status_code=404, detail=f"unknown domain '{domain}'")
        return ResourceSyncStatus(
            domain=domain,
            state="unavailable",
            commit=None,
            nodes=None,
            links=None,
            error=None,
            started_at=None,
            finished_at=None,
        )
    if request.app.state.settings.serverless:
        saved = load_status(session, _job_key(domain), SyncJob)
        if saved is not None:
            return _status(saved)
    return _status(_jobs(request).status(domain))


@router.get("/{domain_id}/{node_id}", response_model=NodeResourcesOut)
def read_resources(
    domain_id: str,
    node_id: str,
    request: Request,
    catalog: UserCatalog,
    session: Annotated[Session, Depends(get_session)],
) -> NodeResourcesOut:
    full_id = require_node(catalog, domain_id, node_id)
    rows = node_resources(session, full_id)
    mapping = _mappings(request).get(domain_id)
    source_url = (
        mapping.source_url(full_id) if mapping is not None else f"https://roadmap.sh/{domain_id}"
    )
    return NodeResourcesOut(
        node_id=full_id,
        source=SOURCE,
        commit=rows[0].commit if rows else None,
        synced_at=max(r.fetched_at for r in rows) if rows else None,
        source_url=source_url,
        items=[
            ResourceItem(url=r.url, title=r.title, type=r.type, source_ref=r.source_ref)
            for r in rows
        ],
    )
