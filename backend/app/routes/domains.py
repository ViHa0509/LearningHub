from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import Note, get_session
from app.roadmaps import Domain, RoadmapCatalog
from app.schemas import DomainSummary, NodeCounts, NodeOut, RoadmapOut

router = APIRouter(prefix="/api/domains", tags=["domains"])


def get_catalog(request: Request) -> RoadmapCatalog:
    catalog: RoadmapCatalog = request.app.state.catalog
    return catalog


def require_domain(catalog: RoadmapCatalog, domain_id: str) -> Domain:
    domain = catalog.domain(domain_id)
    if domain is None:
        raise HTTPException(status_code=404, detail=f"unknown domain '{domain_id}'")
    return domain


@router.get("", response_model=list[DomainSummary])
def list_domains(
    request: Request, session: Annotated[Session, Depends(get_session)]
) -> list[DomainSummary]:
    linked = set(session.scalars(select(Note.node_id).where(Note.node_id.is_not(None)).distinct()))
    return [
        DomainSummary(
            id=d.id,
            title=d.title,
            description=d.description,
            node_count=len(d.nodes),
            learned_nodes=sum(1 for n in d.nodes if n.full_id in linked),
        )
        for d in get_catalog(request).domains()
    ]


@router.get("/{domain_id}/roadmap", response_model=RoadmapOut)
def read_roadmap(domain_id: str, request: Request) -> RoadmapOut:
    domain = require_domain(get_catalog(request), domain_id)
    return RoadmapOut(
        id=domain.id,
        title=domain.title,
        nodes=[
            NodeOut(
                id=n.id,
                full_id=n.full_id,
                title=n.title,
                description=n.description,
                parent=n.parent,
                order=n.order,
            )
            for n in domain.nodes
        ],
    )


@router.get("/{domain_id}/counts", response_model=NodeCounts)
def read_counts(
    domain_id: str, request: Request, session: Annotated[Session, Depends(get_session)]
) -> NodeCounts:
    """Number of notes per node of one domain; nodes without notes are left out."""
    domain = require_domain(get_catalog(request), domain_id)
    known = {n.full_id: n.id for n in domain.nodes}
    rows = session.execute(
        select(Note.node_id, func.count())
        .where(Note.node_id.in_(list(known)))
        .group_by(Note.node_id)
    )
    return NodeCounts(domain=domain.id, counts={known[node]: count for node, count in rows if node})
