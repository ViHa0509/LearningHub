"""Learning fields, their areas and the topics of an area (change learning-fields).

A field belongs to its user; the admin may publish it, which shows it read only to every
account. Someone else's private field or area answers 404, a published one 403 on a change.
Areas are domains of the user's catalog (``app/learning/catalog.py``); an area's slug is global
and never changes, so notes keep their topic.
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import Select, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.current import ADMIN_ONLY, CurrentUser
from app.db import LearningArea, LearningField, LearningTopic, User, get_session
from app.learning.catalog import UserCatalog, build_domain, visible_fields
from app.learning.topics import MAX_TOPICS, clean_topics
from app.roadmaps import KEBAB, RoadmapCatalog
from app.routes.domains import IT_FIELD_TITLE, domain_summary, linked_nodes, roadmap_out
from app.routes.guard import require_app_header
from app.schemas import DomainSummary, RoadmapOut

router = APIRouter(tags=["fields"])
guarded = [Depends(require_app_header)]

IT_FIELD_ID = "it"
NOT_OWNER = "Only the owner can change this"
IT_READ_ONLY = "The IT field holds the built-in roadmaps and cannot be changed"

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Slug = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=40, pattern=KEBAB.pattern),
]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Position = Annotated[int, Field(ge=0, le=10_000)]


class FieldCreate(BaseModel):
    title: Title


class FieldUpdate(BaseModel):
    title: Title | None = None
    order: Position | None = None
    published: bool | None = None


class AreaCreate(BaseModel):
    slug: Slug
    title: Title
    description: Description = ""


class AreaUpdate(BaseModel):
    title: Title | None = None
    description: Description | None = None
    order: Position | None = None


class TopicIn(BaseModel):
    slug: str
    title: str
    description: str | None = None
    parent: str | None = None


class TopicsIn(BaseModel):
    topics: list[TopicIn]


class FieldOut(BaseModel):
    id: str
    title: str
    order: int
    published: bool
    editable: bool
    areas: list[DomainSummary]


def _field_out(field: LearningField, user: User, areas: list[DomainSummary]) -> FieldOut:
    return FieldOut(
        id=str(field.id),
        title=field.title,
        order=field.position,
        published=field.published,
        editable=field.user_id == user.id,
        areas=areas,
    )


def _areas_of(
    catalog: RoadmapCatalog, session: Session, user: User, field: LearningField
) -> list[DomainSummary]:
    linked = linked_nodes(session, user.id)
    summaries = [
        domain_summary(d, linked) for d in catalog.domains() if d.field_id == str(field.id)
    ]
    for summary in summaries:  # the catalog was built before a rename in this request
        summary.field_title = field.title
    return summaries


def _load_field(session: Session, user: User, raw_id: str, *, change: bool) -> LearningField:
    if raw_id == IT_FIELD_ID:
        if change:
            raise HTTPException(status_code=403, detail=IT_READ_ONLY)
        raise HTTPException(status_code=404, detail="field not found")
    try:
        field_id = uuid.UUID(raw_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="field not found") from None
    field = session.get(LearningField, field_id)
    if field is None or (field.user_id != user.id and not field.published):
        raise HTTPException(status_code=404, detail="field not found")
    if change and field.user_id != user.id:
        raise HTTPException(status_code=403, detail=NOT_OWNER)
    return field


def _load_area(
    session: Session, user: User, slug: str, *, change: bool
) -> tuple[LearningArea, LearningField]:
    area = session.scalar(select(LearningArea).where(LearningArea.slug == slug))
    field = session.get(LearningField, area.field_id) if area is not None else None
    if area is None or field is None or (field.user_id != user.id and not field.published):
        raise HTTPException(status_code=404, detail=f"unknown area '{slug}'")
    if change and field.user_id != user.id:
        raise HTTPException(status_code=403, detail=NOT_OWNER)
    return area, field


def _next_position(session: Session, top: Select[Any]) -> int:
    value: int | None = session.scalar(top)
    return 0 if value is None else value + 1


def _it_field(catalog: RoadmapCatalog, session: Session, user: User) -> FieldOut:
    linked = linked_nodes(session, user.id)
    return FieldOut(
        id=IT_FIELD_ID,
        title=IT_FIELD_TITLE,
        order=-1,
        published=False,
        editable=False,
        areas=[domain_summary(d, linked) for d in catalog.domains() if d.field_id is None],
    )


@router.get("/api/fields", response_model=list[FieldOut])
def list_fields(
    catalog: UserCatalog, session: Annotated[Session, Depends(get_session)], user: CurrentUser
) -> list[FieldOut]:
    """The virtual IT field first (the home tabs' order), then own and published fields."""
    out = [_it_field(catalog, session, user)]
    for field in visible_fields(session, user.id):
        out.append(_field_out(field, user, _areas_of(catalog, session, user, field)))
    return out


@router.post("/api/fields", response_model=FieldOut, status_code=201, dependencies=guarded)
def create_field(
    payload: FieldCreate, session: Annotated[Session, Depends(get_session)], user: CurrentUser
) -> FieldOut:
    field = LearningField(
        user_id=user.id,
        title=payload.title,
        position=_next_position(
            session,
            select(func.max(LearningField.position)).where(LearningField.user_id == user.id),
        ),
    )
    session.add(field)
    session.commit()
    return _field_out(field, user, [])


@router.patch("/api/fields/{field_id}", response_model=FieldOut, dependencies=guarded)
def update_field(
    field_id: str,
    payload: FieldUpdate,
    catalog: UserCatalog,
    session: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
) -> FieldOut:
    field = _load_field(session, user, field_id, change=True)
    given = payload.model_fields_set
    if "published" in given and user.role != "admin":
        raise HTTPException(status_code=403, detail=ADMIN_ONLY)
    if "title" in given and payload.title is not None:
        field.title = payload.title
    if "order" in given and payload.order is not None:
        field.position = payload.order
    if "published" in given and payload.published is not None:
        field.published = payload.published
    session.commit()
    return _field_out(field, user, _areas_of(catalog, session, user, field))


@router.delete("/api/fields/{field_id}", status_code=204, dependencies=guarded)
def delete_field(
    field_id: str, session: Annotated[Session, Depends(get_session)], user: CurrentUser
) -> Response:
    """Deletes the areas and topics with it; notes and lessons stay (their topic is missing)."""
    field = _load_field(session, user, field_id, change=True)
    session.delete(field)
    session.commit()
    return Response(status_code=204)


@router.post(
    "/api/fields/{field_id}/areas",
    response_model=DomainSummary,
    status_code=201,
    dependencies=guarded,
)
def create_area(
    field_id: str,
    payload: AreaCreate,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
) -> DomainSummary:
    field = _load_field(session, user, field_id, change=True)
    taken = HTTPException(
        status_code=409, detail=f"the slug '{payload.slug}' is taken; pick another slug"
    )
    if request.app.state.catalog.domain(payload.slug) is not None or session.scalar(
        select(LearningArea.id).where(LearningArea.slug == payload.slug)
    ):
        raise taken
    area = LearningArea(
        field_id=field.id,
        slug=payload.slug,
        title=payload.title,
        description=payload.description,
        position=_next_position(
            session,
            select(func.max(LearningArea.position)).where(LearningArea.field_id == field.id),
        ),
    )
    session.add(area)
    try:
        session.commit()
    except IntegrityError:  # another request took the slug first
        session.rollback()
        raise taken from None
    return domain_summary(build_domain(field, area, [], True), set())


def _topic_rows(session: Session, area: LearningArea) -> list[LearningTopic]:
    return list(
        session.scalars(
            select(LearningTopic)
            .where(LearningTopic.area_id == area.id)
            .order_by(LearningTopic.position)
        )
    )


@router.patch("/api/areas/{slug}", response_model=DomainSummary, dependencies=guarded)
def update_area(
    slug: str,
    payload: AreaUpdate,
    session: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
) -> DomainSummary:
    area, field = _load_area(session, user, slug, change=True)
    given = payload.model_fields_set
    if "title" in given and payload.title is not None:
        area.title = payload.title
    if "description" in given and payload.description is not None:
        area.description = payload.description
    if "order" in given and payload.order is not None:
        area.position = payload.order
    session.commit()
    topics = _topic_rows(session, area)
    return domain_summary(build_domain(field, area, topics, True), linked_nodes(session, user.id))


@router.delete("/api/areas/{slug}", status_code=204, dependencies=guarded)
def delete_area(
    slug: str, session: Annotated[Session, Depends(get_session)], user: CurrentUser
) -> Response:
    area, _ = _load_area(session, user, slug, change=True)
    session.delete(area)
    session.commit()
    return Response(status_code=204)


@router.put("/api/areas/{slug}/topics", response_model=RoadmapOut, dependencies=guarded)
def replace_topics(
    slug: str,
    payload: TopicsIn,
    session: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
) -> RoadmapOut:
    """Replace the whole topic list in one transaction; the order is the list order. 422 with
    ``detail: [{index, field, msg}]`` when a topic is invalid (nothing is saved)."""
    area, field = _load_area(session, user, slug, change=True)
    if len(payload.topics) > MAX_TOPICS:
        raise HTTPException(
            status_code=422,
            detail=[{"index": None, "field": "topics", "msg": f"at most {MAX_TOPICS} topics"}],
        )
    topics, errors = clean_topics(
        [(t.slug, t.title, t.description, t.parent) for t in payload.topics]
    )
    if errors:
        raise HTTPException(status_code=422, detail=[e.as_dict() for e in errors])
    session.execute(delete(LearningTopic).where(LearningTopic.area_id == area.id))
    session.add_all(
        LearningTopic(
            area_id=area.id,
            slug=t.slug,
            title=t.title,
            description=t.description,
            parent_slug=t.parent,
            position=position,
        )
        for position, t in enumerate(topics)
    )
    session.commit()
    return roadmap_out(build_domain(field, area, _topic_rows(session, area), True))
