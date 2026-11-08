from typing import Annotated, cast

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import Lesson, get_session
from app.lesson_pdf import PdfImportError, extract_pdf
from app.roadmaps import RoadmapCatalog
from app.routes.guard import require_app_header
from app.schemas import LessonOut, LessonSource, LessonWrite

router = APIRouter(prefix="/api/lessons", tags=["lessons"])


class ExtractedPdfOut(BaseModel):
    markdown: str
    pages: int
    truncated: bool
    warning: str | None


@router.post(
    "/extract-pdf", response_model=ExtractedPdfOut, dependencies=[Depends(require_app_header)]
)
def extract_lesson_pdf(request: Request, file: Annotated[UploadFile, File()]) -> ExtractedPdfOut:
    """Text of a PDF for the lesson editor; nothing is stored, the user saves the lesson."""
    limit: int = request.app.state.settings.max_upload_bytes
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status_code=422, detail=f"the PDF is larger than {limit // (1024 * 1024)} MB"
        )
    try:
        extracted = extract_pdf(data)
    except PdfImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ExtractedPdfOut(**extracted.__dict__)


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
