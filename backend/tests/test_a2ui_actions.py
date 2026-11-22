"""Spec: a2ui-chat - Grade an answer; Bank answers count as practice."""

import random
import uuid
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.a2ui.bank import draw_bank_questions
from app.a2ui.content import QuizContent, QuizQuestion
from app.a2ui.grading import replay
from app.a2ui.templates import answer_key_for, build_quiz
from app.db import A2uiSurface, User
from tests.test_question_banks import SLUG, driving, make_bank, question_list

QUIZ = QuizContent(
    title="Docker networking",
    questions=[
        QuizQuestion(
            text=f"Question {n}?",
            options=["bridge", "host", "none"],
            answer=2,
            explanation=f"Because {n}.",
        )
        for n in range(1, 4)
    ],
)


def _user(app: FastAPI, role: str = "admin") -> User:
    with app.state.session_factory() as db:
        user: User = db.scalars(select(User).where(User.role == role)).one()
        db.expunge(user)
        return user


def add_surface(client: TestClient, role: str = "admin", **extra: Any) -> str:
    """A stored quiz surface of the admin (or member), as the runner stores one."""
    app: FastAPI = client.app  # type: ignore[assignment]
    user = _user(app, role)
    row_id = uuid.uuid4()
    with app.state.session_factory() as db:
        db.add(
            A2uiSurface(
                id=row_id,
                user_id=user.id,
                kind="quiz",
                title=QUIZ.title,
                messages=build_quiz(f"a2ui-{row_id}", QUIZ),
                answer_key=extra.get("key", answer_key_for(QUIZ)),
                answers={},
            )
        )
        db.commit()
    return str(row_id)


def act(
    client: TestClient,
    surface: str,
    question: Any = "q1",
    choice: Any = ("2",),
    name: str = "check_answer",
    **kwargs: Any,
) -> Any:
    body = {
        "version": "v0.9",
        "action": {
            "name": name,
            "surfaceId": f"a2ui-{surface}",
            "sourceComponentId": "q1-check",
            "timestamp": "2026-11-22T10:00:00.000Z",
            "context": {"question": question, "choice": list(choice) if choice else choice},
        },
    }
    return client.post(f"/api/a2ui/surfaces/{surface}/actions", json=body, **kwargs)


def updates(response: Any) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    return {
        m["updateDataModel"]["path"]: m["updateDataModel"]["value"]
        for m in response.json()["messages"]
    }


# Scenario: Right answer
def test_right_answer(client: TestClient) -> None:
    surface = add_surface(client)
    got = updates(act(client, surface, "q1", ["2"]))
    assert got["/questions/q1/status"] == "correct"
    assert got["/questions/q1/feedback"] == "Correct. Because 1."
    assert got["/questions/q1/mark"] == "✓ Correct"
    assert got["/questions/q1/options/1/label"] == "host ✓"
    assert got["/score/text"] == "1 / 3 answered, 1 correct"


# Scenario: Wrong answer
def test_wrong_answer_names_the_correct_option(client: TestClient) -> None:
    surface = add_surface(client)
    got = updates(act(client, surface, "q2", ["3"]))
    assert got["/questions/q2/status"] == "wrong"
    assert got["/questions/q2/feedback"] == 'Not quite. The answer is "host". Because 2.'
    assert got["/questions/q2/mark"] == "✗ Not quite"
    # The correct option (2, "host") is marked, not the one the user picked (3).
    assert got["/questions/q2/options/1/label"] == "host ✓"
    assert "/questions/q2/options/2/label" not in got
    assert got["/score/text"] == "1 / 3 answered, 0 correct"


# Scenario: Answer twice
def test_a_question_is_graded_once(client: TestClient) -> None:
    surface = add_surface(client)
    first = updates(act(client, surface, "q1", ["3"]))
    second = updates(act(client, surface, "q1", ["2"]))
    assert second == first
    assert second["/questions/q1/status"] == "wrong"
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        row = db.get(A2uiSurface, uuid.UUID(surface))
        assert row is not None and row.answers == {"q1": {"choice": 3, "correct": False}}


def test_a_plain_string_choice_is_accepted(client: TestClient) -> None:
    surface = add_surface(client)
    response = client.post(
        f"/api/a2ui/surfaces/{surface}/actions",
        json={
            "version": "v0.9",
            "action": {
                "name": "check_answer",
                "surfaceId": f"a2ui-{surface}",
                "context": {"question": "q3", "choice": "2"},
            },
        },
    )
    assert updates(response)["/questions/q3/status"] == "correct"


# Scenario: Someone else's surface
def test_another_users_surface_is_404(client: TestClient, second_client: TestClient) -> None:
    surface = add_surface(client)
    response = act(second_client, surface)
    assert response.status_code == 404
    assert act(client, str(uuid.uuid4())).status_code == 404
    assert client.post("/api/a2ui/surfaces/not-a-uuid/actions", json={}).status_code in (404, 422)


# Scenario: Unknown action or question
def test_unknown_action_question_or_option_is_400_and_records_nothing(client: TestClient) -> None:
    surface = add_surface(client)
    assert act(client, surface, name="delete_everything").status_code == 400
    assert act(client, surface, question="q9").status_code == 400
    assert act(client, surface, question=None).status_code == 400
    assert act(client, surface, choice=["4"]).status_code == 400
    assert act(client, surface, choice=["0"]).status_code == 400
    assert act(client, surface, choice=["1", "2"]).status_code == 400
    assert act(client, surface, choice=["x"]).status_code == 400
    assert act(client, surface, choice=None).status_code == 400
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        row = db.get(A2uiSurface, uuid.UUID(surface))
        assert row is not None and row.answers == {}


def test_the_app_header_is_required(client: TestClient) -> None:
    surface = add_surface(client)
    response = act(client, surface, headers={"X-LearningHub": ""})
    assert response.status_code == 403


def test_replay_adds_the_results_of_answered_questions(client: TestClient) -> None:
    surface = add_surface(client)
    act(client, surface, "q2", ["2"])
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        row = db.get(A2uiSurface, uuid.UUID(surface))
        assert row is not None
        messages = replay(row)
    extra = messages[len(row.messages) :]
    paths = [m["updateDataModel"]["path"] for m in extra]
    assert paths == [
        "/questions/q2/status",
        "/questions/q2/mark",
        "/questions/q2/feedback",
        "/questions/q2/options/1/label",
        "/score/text",
    ]
    values = {m["updateDataModel"]["path"]: m["updateDataModel"]["value"] for m in extra}
    assert values["/questions/q2/mark"] == "✓ Correct"


# Scenario: Wrong bank answer
def test_a_wrong_bank_answer_counts_in_the_wrong_questions_practice(client: TestClient) -> None:
    driving(client)
    bank = make_bank(client)
    app: FastAPI = client.app  # type: ignore[assignment]
    user = _user(app)
    row_id = uuid.uuid4()
    with app.state.session_factory() as db:
        drawn = draw_bank_questions(db, user, SLUG, "chuong-1", 3, rng=random.Random(1))
        assert drawn is not None
        key = answer_key_for(drawn.content)
        for qid, bank_id in drawn.bank_ids.items():
            key[qid]["bank_question_id"] = str(bank_id)
        db.add(
            A2uiSurface(
                id=row_id,
                user_id=user.id,
                kind="practice",
                title=drawn.content.title,
                messages=build_quiz(f"a2ui-{row_id}", drawn.content, drawn.images),
                answer_key=key,
                answers={},
            )
        )
        db.commit()
        wrong_choice = 1 if key["q1"]["answer"] != 1 else 2
        bank_q1 = str(drawn.bank_ids["q1"])
    assert question_list(client, bank, wrong="true") == []
    got = updates(act(client, str(row_id), "q1", [str(wrong_choice)]))
    assert got["/questions/q1/status"] == "wrong"
    assert [q["id"] for q in question_list(client, bank, wrong="true")] == [bank_q1]
