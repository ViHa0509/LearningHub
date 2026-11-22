"""Who sees a question bank: whoever sees its area (own field or published field).

Shared by the practice routes and the chat's interactive practice (change a2ui-chat-agent), so
the access rule lives in one place.
"""

import uuid

from sqlalchemy.orm import Session

from app.db import LearningArea, LearningField, QuestionBank, User


def visible_field(session: Session, user: User, area: LearningArea) -> LearningField | None:
    """The area's field when the user sees it (own field or published); otherwise None."""
    field = session.get(LearningField, area.field_id)
    if field is None or (field.user_id != user.id and not field.published):
        return None
    return field


def visible_bank(
    session: Session, user: User, bank_id: uuid.UUID
) -> tuple[QuestionBank, LearningArea, LearningField] | None:
    """The bank with its area and field when the user sees it; otherwise None."""
    bank = session.get(QuestionBank, bank_id)
    area = session.get(LearningArea, bank.area_id) if bank is not None else None
    field = visible_field(session, user, area) if area is not None else None
    if bank is None or area is None or field is None:
        return None
    return bank, area, field
