"""Top-bar search: topics, lessons and notes of the signed-in user in one answer."""

from typing import Annotated, cast

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import case, or_, select

from app.auth.current import CurrentUser, DbDep
from app.db import Lesson, Note
from app.learning.catalog import UserCatalog
from app.schemas import LessonSource
from app.text_search import like_pattern, snippet

router = APIRouter(prefix="/api/search", tags=["search"])

MIN_CHARS = 2
TOPIC_LIMIT = 5
LESSON_LIMIT = 5
NOTE_LIMIT = 8
# More rows than the limit, so a few lessons on topics that are gone cannot empty the group.
LESSON_FETCH = 50


class TopicHit(BaseModel):
    node_id: str
    title: str
    domain_title: str


class LessonHit(BaseModel):
    node_id: str
    title: str
    domain_title: str
    source: LessonSource
    snippet: str


class NoteHit(BaseModel):
    id: str
    title: str
    node_id: str | None
    snippet: str


class SearchOut(BaseModel):
    query: str
    topics: list[TopicHit]
    lessons: list[LessonHit]
    notes: list[NoteHit]


@router.get("", response_model=SearchOut)
def search(
    q: Annotated[str, Query(max_length=100)],
    user: CurrentUser,
    catalog: UserCatalog,
    db: DbDep,
) -> SearchOut:
    """Substring search, case-insensitive; text under 2 characters answers empty groups."""
    query = q.strip()
    if len(query) < MIN_CHARS:
        return SearchOut(query=query, topics=[], lessons=[], notes=[])

    needle = query.lower()
    by_title: list[TopicHit] = []
    by_description: list[TopicHit] = []
    for domain in catalog.domains():
        for node in domain.nodes:
            hit = TopicHit(
                node_id=f"{node.domain}/{node.id}", title=node.title, domain_title=domain.title
            )
            if needle in node.title.lower():
                by_title.append(hit)
            elif node.description and needle in node.description.lower():
                by_description.append(hit)
    topics = [*by_title, *by_description][:TOPIC_LIMIT]

    pattern = like_pattern(query)
    lessons: list[LessonHit] = []
    rows = db.scalars(
        select(Lesson)
        .where(Lesson.user_id == user.id, Lesson.body.ilike(pattern, escape="\\"))
        .order_by(Lesson.updated_at.desc(), Lesson.node_id)
        .limit(LESSON_FETCH)
    )
    for lesson in rows:
        topic = catalog.node(lesson.node_id)
        area = catalog.domain(topic.domain) if topic else None
        if topic is None or area is None:
            continue
        lessons.append(
            LessonHit(
                node_id=lesson.node_id,
                title=topic.title,
                domain_title=area.title,
                source=cast(LessonSource, lesson.source),
                snippet=snippet(lesson.body, query),
            )
        )
        if len(lessons) == LESSON_LIMIT:
            break

    note_rows = db.scalars(
        select(Note)
        .where(
            Note.user_id == user.id,
            Note.archived_at.is_(None),
            or_(
                Note.title.ilike(pattern, escape="\\"),
                Note.body_text.ilike(pattern, escape="\\"),
            ),
        )
        .order_by(
            case((Note.title.ilike(pattern, escape="\\"), 0), else_=1),
            Note.created_at.desc(),
            Note.id,
        )
        .limit(NOTE_LIMIT)
    )
    notes = [
        NoteHit(id=str(n.id), title=n.title, node_id=n.node_id, snippet=snippet(n.body_text, query))
        for n in note_rows
    ]
    return SearchOut(query=query, topics=topics, lessons=lessons, notes=notes)
