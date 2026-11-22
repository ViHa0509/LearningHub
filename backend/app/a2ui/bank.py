"""Practice from the question bank (design 3): no model call.

The bank is the first one in the page's area that the user can see (same rule as the practice
routes, ``app.practice.access``). Questions on the current topic come first, then the rest.
"""

import random
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.a2ui.content import QuizContent, QuizQuestion
from app.db import LearningArea, Question, QuestionBank, User
from app.practice.access import visible_field

DEFAULT_COUNT = 5
MAX_COUNT = 10
NO_EXPLANATION = "No explanation in the bank."


@dataclass
class BankDraw:
    """Drawn questions as quiz content, with the bank ids and image addresses by question id.

    ``content`` is built without the generated-quiz limits: a bank may hold fewer than 3 questions.
    """

    bank_title: str
    content: QuizContent
    bank_ids: dict[str, str] = field(default_factory=dict)  # "q1" -> bank question id
    images: dict[str, str] = field(default_factory=dict)  # "q1" -> "/api/questions/<id>/image"


def _visible_bank(session: Session, user: User, area_slug: str) -> QuestionBank | None:
    area = session.scalar(select(LearningArea).where(LearningArea.slug == area_slug))
    if area is None or visible_field(session, user, area) is None:
        return None
    return session.scalars(
        select(QuestionBank)
        .where(QuestionBank.area_id == area.id)
        .order_by(QuestionBank.created_at, QuestionBank.id)
    ).first()


def draw_bank_questions(
    session: Session,
    user: User,
    area_slug: str | None,
    node_slug: str | None,
    count: int | None = None,
    rng: random.Random | None = None,
) -> BankDraw | None:
    """Up to ``count`` questions (default 5, at most 10), or None when there is no visible bank.

    ``node_slug`` is the topic slug of the current node (the part after ``domain/``); its
    questions come first.
    """
    if not area_slug:
        return None
    bank = _visible_bank(session, user, area_slug)
    if bank is None:
        return None
    wanted = DEFAULT_COUNT if count is None else max(1, min(count, MAX_COUNT))
    rng = rng or random.Random()
    rows = list(session.scalars(select(Question).where(Question.bank_id == bank.id)))
    here = [q for q in rows if node_slug and q.topic_slug == node_slug]
    rest = [q for q in rows if q not in here]
    rng.shuffle(here)
    rng.shuffle(rest)
    drawn = (here + rest)[:wanted]
    if not drawn:
        return None
    questions: list[QuizQuestion] = []
    bank_ids: dict[str, str] = {}
    images: dict[str, str] = {}
    for number, row in enumerate(drawn, start=1):
        qid = f"q{number}"
        questions.append(
            QuizQuestion.model_construct(
                text=row.text,
                options=list(row.options),
                answer=row.answer,
                explanation=row.explanation or NO_EXPLANATION,
            )
        )
        bank_ids[qid] = str(row.id)
        if row.image_key:
            images[qid] = f"/api/questions/{row.id}/image"
    content = QuizContent.model_construct(title=bank.title[:120], questions=questions)
    return BankDraw(bank.title, content, bank_ids, images)
