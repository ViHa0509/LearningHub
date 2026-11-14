"""The catalog one user sees: the built-in roadmaps plus their own and published areas."""

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth.current import CurrentUser
from app.db import LearningArea, LearningField, LearningTopic, User, get_session
from app.roadmaps import Domain, Node, RoadmapCatalog


def build_domain(
    field: LearningField, area: LearningArea, topics: list[LearningTopic], editable: bool
) -> Domain:
    """An area as a ``Domain``; topics are in saved order and ``order`` counts per parent."""
    siblings: dict[str | None, int] = {}
    nodes: list[Node] = []
    for topic in topics:
        order = siblings.get(topic.parent_slug, 0)
        siblings[topic.parent_slug] = order + 1
        nodes.append(
            Node(
                domain=area.slug,
                id=topic.slug,
                title=topic.title,
                description=topic.description or None,
                parent=topic.parent_slug,
                order=order,
            )
        )
    return Domain(
        id=area.slug,
        title=area.title,
        nodes=tuple(nodes),
        description=area.description or None,
        field_id=str(field.id),
        field_title=field.title,
        editable=editable,
    )


def visible_fields(session: Session, user_id: object) -> list[LearningField]:
    """The user's own fields and the published ones, in order."""
    return list(
        session.scalars(
            select(LearningField)
            .where(or_(LearningField.user_id == user_id, LearningField.published.is_(True)))
            .order_by(LearningField.position, LearningField.created_at, LearningField.id)
        )
    )


def catalog_for(session: Session, user: User, builtin: RoadmapCatalog) -> RoadmapCatalog:
    """Built-in domains, then the areas of the visible fields (fields by order, areas by order)."""
    fields = visible_fields(session, user.id)
    domains = builtin.domains()
    if not fields:
        return builtin
    by_field = {f.id: f for f in fields}
    areas = list(
        session.scalars(
            select(LearningArea)
            .where(LearningArea.field_id.in_(list(by_field)))
            .order_by(LearningArea.position, LearningArea.slug)
        )
    )
    topics: dict[object, list[LearningTopic]] = {a.id: [] for a in areas}
    if areas:
        for topic in session.scalars(
            select(LearningTopic)
            .where(LearningTopic.area_id.in_(list(topics)))
            .order_by(LearningTopic.area_id, LearningTopic.position)
        ):
            topics[topic.area_id].append(topic)
    rank = {f.id: i for i, f in enumerate(fields)}
    areas.sort(key=lambda a: rank[a.field_id])  # stable: areas stay in their own order
    taken = {d.id for d in domains}
    extra = []
    for area in areas:
        if area.slug in taken:  # cannot happen (creation refuses it); never shadow a roadmap
            continue
        field = by_field[area.field_id]
        extra.append(build_domain(field, area, topics[area.id], field.user_id == user.id))
    return RoadmapCatalog([*domains, *extra])


def user_catalog(
    request: Request, session: Annotated[Session, Depends(get_session)], user: CurrentUser
) -> RoadmapCatalog:
    """The catalog of the current user; FastAPI builds it once per request."""
    return catalog_for(session, user, request.app.state.catalog)


UserCatalog = Annotated[RoadmapCatalog, Depends(user_catalog)]
