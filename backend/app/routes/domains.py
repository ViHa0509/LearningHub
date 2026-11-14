from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.current import CurrentUser
from app.db import Note, get_session
from app.learning.catalog import UserCatalog
from app.roadmaps import Domain, RoadmapCatalog
from app.schemas import DomainSummary, NodeCounts, NodeOut, RoadmapOut

router = APIRouter(prefix="/api/domains", tags=["domains"])


IT_FIELD_TITLE = "IT"


def require_domain(catalog: RoadmapCatalog, domain_id: str) -> Domain:
    domain = catalog.domain(domain_id)
    if domain is None:
        raise HTTPException(status_code=404, detail=f"unknown domain '{domain_id}'")
    return domain


def linked_nodes(session: Session, user_id: UUID) -> set[str]:
    return set(
        session.scalars(
            select(Note.node_id)
            .where(Note.user_id == user_id, Note.node_id.is_not(None), Note.archived_at.is_(None))
            .distinct()
        )
    )


def domain_summary(domain: Domain, linked: set[str]) -> DomainSummary:
    return DomainSummary(
        id=domain.id,
        title=domain.title,
        description=domain.description,
        node_count=len(domain.nodes),
        learned_nodes=sum(1 for n in domain.nodes if n.full_id in linked),
        field_id=domain.field_id,
        field_title=domain.field_title or IT_FIELD_TITLE,
        editable=domain.editable,
    )


@router.get("", response_model=list[DomainSummary])
def list_domains(
    catalog: UserCatalog, session: Annotated[Session, Depends(get_session)], user: CurrentUser
) -> list[DomainSummary]:
    linked = linked_nodes(session, user.id)
    return [domain_summary(d, linked) for d in catalog.domains()]


@router.get("/{domain_id}/roadmap", response_model=RoadmapOut)
def read_roadmap(domain_id: str, catalog: UserCatalog) -> RoadmapOut:
    return roadmap_out(require_domain(catalog, domain_id))


def roadmap_out(domain: Domain) -> RoadmapOut:
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
    domain_id: str,
    catalog: UserCatalog,
    session: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
) -> NodeCounts:
    """Number of notes per node of one domain; nodes without notes are left out."""
    domain = require_domain(catalog, domain_id)
    known = {n.full_id: n.id for n in domain.nodes}
    rows = session.execute(
        select(Note.node_id, func.count())
        .where(Note.user_id == user.id, Note.node_id.in_(list(known)), Note.archived_at.is_(None))
        .group_by(Note.node_id)
    )
    return NodeCounts(domain=domain.id, counts={known[node]: count for node, count in rows if node})
