"""Spec: a2ui-chat - Practice from the question bank (the draw, no model call)."""

import random
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.a2ui.bank import NO_EXPLANATION, BankDraw, draw_bank_questions
from app.a2ui.templates import answer_key_for, build_quiz
from app.db import Question, User
from tests.test_question_banks import (
    JPEG,
    SLUG,
    bank_doc,
    driving,
    make_bank,
    make_questions,
    make_zip,
    upload,
)


def draw(
    client: TestClient,
    email: str | None,
    count: int | None = 5,
    node: str | None = "chuong-1",
    slug: str | None = SLUG,
) -> tuple[BankDraw | None, dict[str, str]]:
    """The draw as a user, and the topic slug of each drawn bank question id."""
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        query = select(User).where(User.email == email) if email else select(User)
        user = db.scalars(query.where(User.role == ("member" if email else "admin"))).one()
        result = draw_bank_questions(db, user, slug, node, count, rng=random.Random(3))
        topics = {str(q.id): q.topic_slug for q in db.scalars(select(Question))}
    return result, topics


def test_five_by_default_from_the_current_topic(client: TestClient) -> None:
    driving(client)
    make_bank(client)  # 20 questions, 6 on chuong-1
    result, topics = draw(client, None, count=None)
    assert result is not None
    assert len(result.content.questions) == 5
    assert [topics[i] for i in result.bank_ids.values()] == ["chuong-1"] * 5
    assert list(result.bank_ids) == ["q1", "q2", "q3", "q4", "q5"]
    assert len(set(result.bank_ids.values())) == 5


def test_current_topic_first_then_other_topics(client: TestClient) -> None:
    driving(client)
    make_bank(client)
    result, topics = draw(client, None, count=9)
    assert result is not None
    drawn = [topics[i] for i in result.bank_ids.values()]
    assert drawn[:6] == ["chuong-1"] * 6
    assert all(t != "chuong-1" for t in drawn[6:]) and len(drawn) == 9


def test_the_count_is_capped_at_ten(client: TestClient) -> None:
    driving(client)
    make_bank(client)
    result, _ = draw(client, None, count=50)
    assert result is not None and len(result.content.questions) == 10


def test_a_small_bank_gives_fewer_questions_than_asked(client: TestClient) -> None:
    driving(client)
    make_bank(
        client,
        bank_doc(
            make_questions(2, critical=()),
            questions=2,
            pass_mark=1,
            min_critical=0,
            critical_fails=False,
            per_topic={},
        ),
    )
    result, _ = draw(client, None, count=5)
    assert result is not None and len(result.content.questions) == 2
    # The templates still build it, with the answer key and no answers in the messages.
    messages = build_quiz("a2ui-x", result.content, result.images)
    assert "Because" not in str(messages)
    assert set(answer_key_for(result.content)) == {"q1", "q2"}


def test_the_image_url_is_set_when_the_question_has_a_picture(client: TestClient) -> None:
    driving(client)
    doc = bank_doc()
    doc["questions"][0]["image"] = "q1.jpg"
    make_bank_response = upload(client, SLUG, make_zip(doc, {"q1.jpg": JPEG}))
    assert make_bank_response.status_code == 201, make_bank_response.text
    result, _ = draw(client, None, count=10, node="chuong-1")
    assert result is not None
    with_image = [q for q, url in result.images.items()]
    assert len(with_image) == 1
    question_id = result.bank_ids[with_image[0]]
    assert result.images[with_image[0]] == f"/api/questions/{question_id}/image"
    assert client.get(result.images[with_image[0]]).status_code == 200


def test_a_null_explanation_becomes_the_placeholder(client: TestClient) -> None:
    driving(client)
    make_bank(client)
    app: FastAPI = client.app  # type: ignore[assignment]
    with app.state.session_factory() as db:
        db.execute(update(Question).values(explanation=None))
        db.commit()
    result, _ = draw(client, None, count=3)
    assert result is not None
    assert {q.explanation for q in result.content.questions} == {NO_EXPLANATION}
    key = answer_key_for(result.content)
    assert key["q1"]["explanation"] == "No explanation in the bank."


def test_answer_and_options_come_from_the_bank(client: TestClient) -> None:
    driving(client)
    make_bank(client)
    result, _ = draw(client, None, count=3)
    assert result is not None
    first: Any = result.content.questions[0]
    number = int(first.text.split()[-1].rstrip("?"))
    assert first.answer == number % 4 + 1 and len(first.options) == 4


def test_no_bank_or_unknown_area_gives_none(client: TestClient) -> None:
    driving(client)
    assert draw(client, None)[0] is None  # an area without a bank
    assert draw(client, None, slug="nowhere")[0] is None
    assert draw(client, None, slug=None)[0] is None


def test_a_bank_the_user_cannot_see_is_not_used(
    client: TestClient, second_client: TestClient
) -> None:
    driving(client)  # the admin's private field
    make_bank(client)
    assert draw(client, "member@example.test")[0] is None
    assert draw(client, None)[0] is not None


def test_a_published_bank_is_used_by_a_member(
    client: TestClient, second_client: TestClient
) -> None:
    driving(client, publish=True)
    make_bank(client)
    result, _ = draw(client, "member@example.test")
    assert result is not None and len(result.content.questions) == 5
