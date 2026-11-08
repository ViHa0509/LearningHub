"""References of roadmap nodes (links synced from roadmap.sh) and the sync job."""

import threading
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db import get_session
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
        threading.Thread(
            target=jobs.run,
            args=(mapping, settings, sessions, request.app.state.resource_getter),
            name=f"resource-sync-{mapping.domain}",
            daemon=True,
        ).start()
    return _status(job)


@router.get("/sync/{domain}", response_model=ResourceSyncStatus)
def sync_status(domain: str, request: Request) -> ResourceSyncStatus:
    _mapping_of(request, domain)
    return _status(_jobs(request).status(domain))


@router.get("/{domain_id}/{node_id}", response_model=NodeResourcesOut)
def read_resources(
    domain_id: str,
    node_id: str,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> NodeResourcesOut:
    full_id = require_node(request, domain_id, node_id)
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
