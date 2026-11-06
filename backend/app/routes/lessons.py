from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db import Lesson, get_session
from app.roadmaps import RoadmapCatalog
from app.schemas import LessonOut, LessonSource, LessonWrite

router = APIRouter(prefix="/api/lessons", tags=["lessons"])


def require_node(request: Request, domain_id: str, node_id: str) -> str:
    catalog: RoadmapCatalog = request.app.state.catalog
    full_id = f"{domain_id}/{node_id}"
    if not catalog.has_node(full_id):
        raise HTTPException(status_code=404, detail=f"unknown node '{full_id}'")
    return full_id


def to_out(full_id: str, lesson: Lesson | None) -> LessonOut:
    if lesson is None:
        return LessonOut(node_id=full_id, body="", source=None, updated_at=None)
    return LessonOut(
        node_id=full_id,
        body=lesson.body,
        source=cast(LessonSource, lesson.source),
        updated_at=lesson.updated_at,
    )


@router.get("/{domain_id}/{node_id}", response_model=LessonOut)
def read_lesson(
    domain_id: str,
    node_id: str,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> LessonOut:
    full_id = require_node(request, domain_id, node_id)
    return to_out(full_id, session.get(Lesson, full_id))


@router.put("/{domain_id}/{node_id}", response_model=LessonOut)
def write_lesson(
    domain_id: str,
    node_id: str,
    payload: LessonWrite,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> LessonOut:
    """Replace the node's lesson; an empty or whitespace-only body removes it."""
    full_id = require_node(request, domain_id, node_id)
    lesson = session.get(Lesson, full_id)
    if not payload.body.strip():
        if lesson is not None:
            session.delete(lesson)
            session.commit()
        return to_out(full_id, None)
    if lesson is None:
        lesson = Lesson(node_id=full_id, body=payload.body, source=payload.source)
        session.add(lesson)
    else:
        lesson.body = payload.body
        lesson.source = payload.source
    session.commit()
    session.refresh(lesson)
    return to_out(full_id, lesson)
