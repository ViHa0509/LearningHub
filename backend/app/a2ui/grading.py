"""Grading answers on a stored surface, and replaying them (change a2ui-chat-agent).

The answer key never leaves the server except as the result of a question already answered.
"""

from typing import Any

from app.a2ui.templates import grade_messages, score_text
from app.db import A2uiSurface

Message = dict[str, Any]


class GradeError(ValueError):
    """The action names no known question or option: answered with 400."""


def surface_id_of(row: A2uiSurface) -> str:
    return f"a2ui-{row.id}"


def _score(row: A2uiSurface) -> str:
    answers: dict[str, Any] = row.answers or {}
    correct = sum(1 for a in answers.values() if a.get("correct"))
    return score_text(len(answers), len(row.answer_key or {}), correct)


def _result_messages(row: A2uiSurface, question_id: str) -> list[Message]:
    key = row.answer_key[question_id]
    given = row.answers[question_id]
    option = key["options"][key["answer"] - 1]
    return grade_messages(
        surface_id_of(row),
        question_id,
        option,
        bool(given["correct"]),
        key.get("explanation") or "",
        _score(row),
        key["answer"],
    )


def choice_of(row: A2uiSurface, question_id: Any, choice: Any) -> tuple[str, int]:
    """The question id and the 1-based option chosen, or GradeError. ``choice`` is what the
    renderer sends for a ChoicePicker: a list with one option value, or the value itself."""
    if not isinstance(question_id, str) or question_id not in (row.answer_key or {}):
        raise GradeError("unknown question")
    if isinstance(choice, list):
        if len(choice) != 1:
            raise GradeError("choose exactly one option")
        choice = choice[0]
    if isinstance(choice, bool) or not isinstance(choice, (str, int)):
        raise GradeError("the choice is not one of the options")
    try:
        number = int(choice)
    except ValueError as exc:
        raise GradeError("the choice is not one of the options") from exc
    options = row.answer_key[question_id]["options"]
    if not 1 <= number <= len(options):
        raise GradeError("the choice is not one of the options")
    return question_id, number


def grade(row: A2uiSurface, question_id: str, number: int) -> tuple[list[Message], bool]:
    """Grade once: a question already answered keeps its first result. Returns the messages
    and whether this call recorded a new answer (the caller then records bank answers)."""
    if question_id in (row.answers or {}):
        return _result_messages(row, question_id), False
    correct = number == row.answer_key[question_id]["answer"]
    # A new dict, so SQLAlchemy sees the JSONB change.
    row.answers = {**(row.answers or {}), question_id: {"choice": number, "correct": correct}}
    return _result_messages(row, question_id), True


def replay(row: A2uiSurface) -> list[Message]:
    """The stored messages followed by the results of the questions already answered."""
    messages = list(row.messages)
    for question_id in sorted(row.answers or {}, key=_question_order):
        messages += _result_messages(row, question_id)
    return messages


def _question_order(question_id: str) -> int:
    return int(question_id[1:]) if question_id[1:].isdigit() else 0
