"""Recording a user's practice or test answer to a bank question (shared by the Practice page
and interactive chat surfaces, change a2ui-chat-agent)."""

import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.db import QuestionAnswer, User


def record_answer(
    session: Session,
    user: User,
    question_id: uuid.UUID,
    correct: bool,
    choice: int,
    now: datetime,
) -> None:
    row = session.get(QuestionAnswer, (user.id, question_id))
    if row is None:
        session.add(
            QuestionAnswer(
                user_id=user.id,
                question_id=question_id,
                last_correct=correct,
                last_choice=choice,
                times_wrong=0 if correct else 1,
                answered_at=now,
            )
        )
        return
    row.last_correct = correct
    row.last_choice = choice
    row.times_wrong += 0 if correct else 1
    row.answered_at = now
