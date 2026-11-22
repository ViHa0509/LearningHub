"""Actions on interactive A2UI surfaces of chat answers (change a2ui-chat-agent).

`check_answer` is graded against the answer key stored with the surface. No model is called, so
no rate-limit slot or shared count is taken. Another user's surface answers 404.
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.a2ui.grading import GradeError, choice_of, grade
from app.a2ui.templates import CHECK_ACTION
from app.auth.current import CurrentUser
from app.db import A2uiSurface, Question, get_session
from app.practice.record import record_answer
from app.routes.guard import require_app_header

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]


class ActionBody(BaseModel):
    name: str = Field(max_length=64)
    surfaceId: str = Field(max_length=100)
    sourceComponentId: str = Field(default="", max_length=100)
    timestamp: str = Field(default="", max_length=40)
    context: dict[str, Any] = Field(default_factory=dict)


class ActionIn(BaseModel):
    version: str = Field(max_length=10)
    action: ActionBody


class ActionOut(BaseModel):
    messages: list[dict[str, Any]]


@router.post(
    "/api/a2ui/surfaces/{surface_id}/actions",
    response_model=ActionOut,
    dependencies=[Depends(require_app_header)],
)
def surface_action(
    surface_id: str,
    payload: ActionIn,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> ActionOut:
    try:
        row_id = uuid.UUID(surface_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="surface not found") from exc
    # Locked: two quick clicks must not grade the same question twice.
    row = session.scalars(
        select(A2uiSurface)
        .where(A2uiSurface.id == row_id, A2uiSurface.user_id == user.id)
        .with_for_update()
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="surface not found")
    if payload.action.name != CHECK_ACTION:
        raise HTTPException(status_code=400, detail=f"unknown action '{payload.action.name}'")
    if len(str(payload.action.context)) > 2000:
        raise HTTPException(status_code=400, detail="the action context is too large")
    try:
        question_id, number = choice_of(
            row, payload.action.context.get("question"), payload.action.context.get("choice")
        )
    except GradeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    messages, recorded = grade(row, question_id, number)
    bank_id = row.answer_key[question_id].get("bank_question_id")
    if recorded and bank_id:
        question = session.get(Question, uuid.UUID(bank_id))
        if question is not None:  # the bank may have been deleted since
            correct = bool(row.answers[question_id]["correct"])
            record_answer(session, user, question.id, correct, number, request.app.state.clock())
    session.commit()
    return ActionOut(messages=messages)
