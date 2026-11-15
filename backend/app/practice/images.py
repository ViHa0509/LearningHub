"""Picture files of question banks, for the routes that delete banks with their area or field."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import LearningArea, Question, QuestionBank
from app.storage import FileStore, release_blob


def image_keys_of_areas(session: Session, area_ids: list[object]) -> set[str]:
    """The picture keys of every question of the banks of these areas."""
    if not area_ids:
        return set()
    return {
        key
        for key in session.scalars(
            select(Question.image_key)
            .join(QuestionBank, QuestionBank.id == Question.bank_id)
            .where(QuestionBank.area_id.in_(area_ids), Question.image_key.is_not(None))
        )
        if key is not None
    }


def image_keys_of_field(session: Session, field_id: object) -> set[str]:
    areas = list(session.scalars(select(LearningArea.id).where(LearningArea.field_id == field_id)))
    return image_keys_of_areas(session, list(areas))


def release_images(session: Session, store: FileStore, keys: set[str]) -> None:
    """Call after the rows are deleted and committed: a file goes when nothing else uses it."""
    for key in keys:
        release_blob(session, store, key)
