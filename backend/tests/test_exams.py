"""Spec: practice-exams - Practice by topic; Mock exam by the bank's rules; Test history and
access. Banks are small and made up (see tests/test_question_banks.py)."""

import random
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import QuestionAnswer
from tests.test_question_banks import (
    answer_of,
    bank_doc,
    driving,
    has_key,
    make_bank,
    make_questions,
    upload,
)

MISSING = "00000000-0000-0000-0000-000000000000"
T0 = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)


def seed(client: TestClient, seed_value: int = 7) -> None:
    client.app.state.exam_random = random.Random(seed_value)  # type: ignore[attr-defined]


def set_clock(client: TestClient, now: datetime) -> None:
    client.app.state.clock = lambda: now  # type: ignore[attr-defined]


def start(client: TestClient, bank: dict[str, Any]) -> dict[str, Any]:
    response = client.post(f"/api/banks/{bank['id']}/exams")
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def exam_with(client: TestClient, **rules: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    """A driving area with a bank of 20 made-up questions and a started test (seeded draw)."""
    driving(client)
    seed(client)
    bank = make_bank(client, bank_doc(**rules))
    return bank, start(client, bank)


def answers(exam: dict[str, Any], wrong: tuple[int, ...] = (), skip: tuple[int, ...] = ()) -> Any:
    """Every question right, except the numbers in ``wrong`` (a wrong option) and ``skip``."""
    out = {}
    for q in exam["questions"]:
        n = q["number"]
        if n in skip:
            continue
        correct = answer_of(n)
        out[q["id"]] = correct % 4 + 1 if n in wrong else correct
    return out


def submit(client: TestClient, exam_id: str, given: dict[str, int]) -> Any:
    return client.post(f"/api/exams/{exam_id}/submit", json={"answers": given})


# --- Practice by topic -------------------------------------------------------------------------


def test_a_wrong_practice_answer_shows_the_right_option_and_joins_got_wrong(
    client: TestClient,
) -> None:
    driving(client)
    bank = make_bank(client)
    url = f"/api/banks/{bank['id']}/questions"
    question = client.get(url, params={"topic": "chuong-1"}).json()[0]
    assert question["number"] == 1 and question["last_correct"] is None
    wrong = client.post(f"/api/questions/{question['id']}/answer", json={"choice": 1})
    assert wrong.status_code == 200
    assert wrong.json() == {"correct": False, "answer": 2, "explanation": "Because 1."}
    got_wrong = client.get(url, params={"wrong": "true"}).json()
    assert [(q["number"], q["last_correct"]) for q in got_wrong] == [(1, False)]
    right = client.post(f"/api/questions/{question['id']}/answer", json={"choice": 2})
    assert right.json()["correct"] is True
    assert client.get(url, params={"wrong": "true"}).json() == []
    assert client.get(url).json()[0]["last_correct"] is True
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        row = db.scalars(select(QuestionAnswer)).one()
        assert (row.last_correct, row.times_wrong) == (True, 1)
    again = client.post(f"/api/questions/{question['id']}/answer", json={"choice": 3})
    assert again.status_code == 200
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        assert db.scalars(select(QuestionAnswer)).one().times_wrong == 2


def test_practice_answer_checks_the_choice_and_the_header(client: TestClient) -> None:
    driving(client)
    bank = make_bank(client)
    qid = client.get(f"/api/banks/{bank['id']}/questions").json()[0]["id"]
    url = f"/api/questions/{qid}/answer"
    assert client.post(url, json={"choice": 5}).status_code == 422
    assert client.post(url, json={"choice": 0}).status_code == 422
    assert client.post(url, json={"choice": "a"}).status_code == 422
    assert client.post(url, json={"choice": 1}, headers={"X-LearningHub": ""}).status_code == 403
    assert client.post(f"/api/questions/{MISSING}/answer", json={"choice": 1}).status_code == 404


def test_member_practises_a_published_banks_questions_with_own_progress(
    client: TestClient, second_client: TestClient
) -> None:
    driving(client, publish=True)
    bank = make_bank(client)
    url = f"/api/banks/{bank['id']}/questions"
    qid = second_client.get(url).json()[0]["id"]
    assert second_client.post(f"/api/questions/{qid}/answer", json={"choice": 1}).status_code == 200
    assert [q["number"] for q in second_client.get(url, params={"wrong": "true"}).json()] == [1]
    assert client.get(url, params={"wrong": "true"}).json() == []  # answers are per user
    assert second_client.get(f"/api/banks/{bank['id']}/exams").json() == []


# --- Mock exam: draw ---------------------------------------------------------------------------


def test_the_draw_follows_the_rules_and_holds_no_answers(client: TestClient) -> None:
    _, exam = exam_with(client)
    questions = exam["questions"]
    assert len(questions) == 10 and len({q["id"] for q in questions}) == 10
    assert sum(1 for q in questions if q["topic"] == "chuong-1") == 3
    assert sum(1 for q in questions if q["critical"]) == 1
    assert not has_key(exam, "answer") and not has_key(exam, "explanation")
    assert exam["answers"] == {} and exam["result"] is None and exam["submitted_at"] is None
    assert all(q["last_correct"] is None for q in questions)
    started = datetime.fromisoformat(exam["started_at"])
    assert datetime.fromisoformat(exam["deadline"]) - started == timedelta(minutes=20)
    fetched = client.get(f"/api/exams/{exam['id']}").json()
    assert fetched == exam and not has_key(fetched, "answer")


def test_the_draw_is_repeatable_with_a_seed_and_differs_otherwise(client: TestClient) -> None:
    driving(client)
    bank = make_bank(client)
    seed(client, 3)
    first = [q["id"] for q in start(client, bank)["questions"]]
    seed(client, 3)
    assert [q["id"] for q in start(client, bank)["questions"]] == first
    seed(client, 4)
    assert [q["id"] for q in start(client, bank)["questions"]] != first


def test_critical_questions_are_drawn_first_then_per_topic_then_the_rest(
    client: TestClient,
) -> None:
    driving(client)
    seed(client)
    rules = {"questions": 12, "min_critical": 2, "per_topic": {"chuong-1": 2, "chuong-2": 3}}
    bank = make_bank(client, bank_doc(**rules))
    for _ in range(5):
        qs = start(client, bank)["questions"]
        assert len(qs) == 12
        assert sum(1 for q in qs if q["critical"]) == 2
        assert sum(1 for q in qs if q["topic"] == "chuong-1") == 2
        # chuong-2 (3 named) and the critical ones are in chuong-3 (19, 20)
        assert sum(1 for q in qs if q["topic"] == "chuong-2") == 3
        assert sum(1 for q in qs if q["topic"] == "chuong-3") == 7


def test_a_bank_with_fewer_questions_than_the_rules_still_draws_what_it_has(
    client: TestClient,
) -> None:
    driving(client)
    bank = make_bank(client, bank_doc(make_questions(10, critical=(10,)), questions=10))
    qs = start(client, bank)["questions"]
    assert sorted(q["number"] for q in qs) == list(range(1, 11))


# --- Mock exam: scoring -------------------------------------------------------------------------


# Scenario: Pass
def test_nine_right_with_every_critical_right_passes(client: TestClient) -> None:
    _, exam = exam_with(client)
    noncritical = next(q["number"] for q in exam["questions"] if not q["critical"])
    response = submit(client, exam["id"], answers(exam, wrong=(noncritical,)))
    assert response.status_code == 200, response.text
    result = response.json()["result"]
    assert (result["score"], result["total"], result["passed"]) == (9, 10, True)
    assert result["failed_on_critical"] == []
    assert response.json()["submitted_at"] is not None


# Scenario: Fail on a critical question
def test_one_wrong_critical_question_fails_the_test_and_is_named(client: TestClient) -> None:
    _, exam = exam_with(client)
    critical = next(q["number"] for q in exam["questions"] if q["critical"])
    result = submit(client, exam["id"], answers(exam, wrong=(critical,))).json()["result"]
    assert result["score"] == 9 and result["passed"] is False
    assert result["failed_on_critical"] == [critical]


def test_an_unanswered_critical_question_fails_the_test(client: TestClient) -> None:
    _, exam = exam_with(client)
    critical = next(q["number"] for q in exam["questions"] if q["critical"])
    result = submit(client, exam["id"], answers(exam, skip=(critical,))).json()["result"]
    assert result["passed"] is False and result["failed_on_critical"] == [critical]


def test_a_critical_question_does_not_fail_when_the_rules_say_so(client: TestClient) -> None:
    _, exam = exam_with(client, critical_fails=False)
    critical = next(q["number"] for q in exam["questions"] if q["critical"])
    result = submit(client, exam["id"], answers(exam, wrong=(critical,))).json()["result"]
    assert result["score"] == 9 and result["passed"] is True
    assert result["failed_on_critical"] == []  # only filled when the rules say so


def test_the_pass_mark_decides_when_every_critical_question_is_right(client: TestClient) -> None:
    _, exam = exam_with(client)
    wrong = tuple(q["number"] for q in exam["questions"] if not q["critical"])[:3]
    result = submit(client, exam["id"], answers(exam, wrong=wrong)).json()["result"]
    assert (result["score"], result["passed"]) == (7, False)
    assert result["failed_on_critical"] == []


def test_the_review_shows_every_question_with_the_choice_and_the_right_option(
    client: TestClient,
) -> None:
    _, exam = exam_with(client)
    skipped = exam["questions"][0]["number"]
    wrong = exam["questions"][1]["number"]
    given = answers(exam, wrong=(wrong,), skip=(skipped,))
    result = submit(client, exam["id"], given).json()["result"]
    review = {r["number"]: r for r in result["review"]}
    assert [r["question_id"] for r in result["review"]] == [q["id"] for q in exam["questions"]]
    assert review[skipped]["choice"] is None and review[skipped]["correct"] is False
    assert review[skipped]["answer"] == answer_of(skipped)
    assert review[wrong]["correct"] is False and review[wrong]["choice"] != answer_of(wrong)
    assert review[wrong]["explanation"] == f"Because {wrong}."
    other = exam["questions"][2]["number"]
    assert review[other]["correct"] is True and review[other]["choice"] == answer_of(other)
    again = client.get(f"/api/exams/{exam['id']}").json()
    assert again["result"] == result and again["answers"] == given


def test_submitting_updates_the_got_wrong_list(client: TestClient) -> None:
    bank, exam = exam_with(client)
    wrong = exam["questions"][1]["number"]
    submit(client, exam["id"], answers(exam, wrong=(wrong,)))
    listed = client.get(f"/api/banks/{bank['id']}/questions", params={"wrong": "true"}).json()
    assert [q["number"] for q in listed] == [wrong]


# Scenario: Time out
def test_time_out_scores_the_saved_answers_and_ignores_later_ones(client: TestClient) -> None:
    _, exam = exam_with(client)
    set_clock(client, T0)
    exam = start(client, {"id": exam["bank_id"]})
    given = answers(exam)
    first_five = dict(list(given.items())[:5])
    assert client.put(f"/api/exams/{exam['id']}/answers", json={"answers": first_five}).is_success
    reloaded = client.get(f"/api/exams/{exam['id']}").json()
    assert reloaded["answers"] == first_five and reloaded["result"] is None
    set_clock(client, T0 + timedelta(minutes=20, seconds=31))
    response = submit(client, exam["id"], given)
    assert response.status_code == 200
    assert response.json()["answers"] == first_five
    assert response.json()["result"]["score"] == 5
    assert response.json()["result"]["passed"] is False


def test_an_answer_within_the_grace_period_still_counts(client: TestClient) -> None:
    _, exam = exam_with(client)
    set_clock(client, T0)
    exam = start(client, {"id": exam["bank_id"]})
    set_clock(client, T0 + timedelta(minutes=20, seconds=29))
    assert submit(client, exam["id"], answers(exam)).json()["result"]["score"] == 10
    assert submit(client, exam["id"], {}).status_code == 409


def test_saving_progress_merges_answers_and_is_refused_once_finished(client: TestClient) -> None:
    _, exam = exam_with(client)
    given = answers(exam)
    ids = list(given)
    client.put(f"/api/exams/{exam['id']}/answers", json={"answers": {ids[0]: 1}})
    client.put(f"/api/exams/{exam['id']}/answers", json={"answers": {ids[1]: 2, ids[0]: 3}})
    assert client.get(f"/api/exams/{exam['id']}").json()["answers"] == {ids[0]: 3, ids[1]: 2}
    submit(client, exam["id"], {ids[2]: 1})
    assert client.get(f"/api/exams/{exam['id']}").json()["answers"] == {
        ids[0]: 3,
        ids[1]: 2,
        ids[2]: 1,
    }
    assert client.put(f"/api/exams/{exam['id']}/answers", json={"answers": {}}).status_code == 409


def test_answers_must_name_questions_of_the_test_and_real_options(client: TestClient) -> None:
    _, exam = exam_with(client)
    qid = exam["questions"][0]["id"]
    put = f"/api/exams/{exam['id']}/answers"
    assert client.put(put, json={"answers": {MISSING: 1}}).status_code == 422
    assert client.put(put, json={"answers": {"nope": 1}}).status_code == 422
    assert client.put(put, json={"answers": {qid: 5}}).status_code == 422
    assert client.put(put, json={"answers": {qid: 0}}).status_code == 422
    assert submit(client, exam["id"], {MISSING: 1}).status_code == 422
    assert client.get(f"/api/exams/{exam['id']}").json()["submitted_at"] is None


def test_exam_writes_need_the_app_header(client: TestClient) -> None:
    bank, exam = exam_with(client)
    off = {"X-LearningHub": ""}
    assert client.post(f"/api/banks/{bank['id']}/exams", headers=off).status_code == 403
    assert (
        client.put(
            f"/api/exams/{exam['id']}/answers", json={"answers": {}}, headers=off
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/exams/{exam['id']}/submit", json={"answers": {}}, headers=off
        ).status_code
        == 403
    )


def test_no_response_before_the_submit_holds_an_answer(client: TestClient) -> None:
    bank, exam = exam_with(client)
    qid = exam["questions"][0]["id"]
    saved = client.put(f"/api/exams/{exam['id']}/answers", json={"answers": {qid: 1}})
    for body in (
        exam,
        saved.json(),
        client.get(f"/api/exams/{exam['id']}").json(),
        client.get(f"/api/banks/{bank['id']}/questions").json(),
        client.get(f"/api/banks/{bank['id']}/exams").json(),
        client.get(f"/api/areas/{bank['area']}/banks").json(),
    ):
        assert not has_key(body, "answer"), body
        assert "explanation" not in str(body)


# --- Test history and access ----------------------------------------------------------------------


def test_history_lists_the_users_tests_newest_first(client: TestClient) -> None:
    driving(client)
    seed(client)
    bank = make_bank(client)
    set_clock(client, T0)
    first = start(client, bank)
    set_clock(client, T0 + timedelta(hours=1))
    second = start(client, bank)
    set_clock(client, T0 + timedelta(minutes=5))
    submit(client, first["id"], answers(first))
    listed = client.get(f"/api/banks/{bank['id']}/exams").json()
    assert [e["id"] for e in listed] == [second["id"], first["id"]]
    assert listed[0]["score"] is None and listed[0]["passed"] is None
    assert listed[0]["submitted_at"] is None and listed[0]["total"] == 10
    assert (listed[1]["score"], listed[1]["passed"], listed[1]["total"]) == (10, True, 10)
    assert listed[1]["submitted_at"] is not None


# Scenario: Another user's test
def test_another_users_test_is_not_found(client: TestClient, second_client: TestClient) -> None:
    driving(client, publish=True)
    seed(client)
    bank = make_bank(client)
    mine = start(client, bank)
    url = f"/api/exams/{mine['id']}"
    assert second_client.get(url).status_code == 404
    assert second_client.put(f"{url}/answers", json={"answers": {}}).status_code == 404
    assert second_client.post(f"{url}/submit", json={"answers": {}}).status_code == 404
    assert client.get(url).status_code == 200
    assert client.get(f"/api/exams/{MISSING}").status_code == 404
    assert client.get("/api/exams/not-a-uuid").status_code == 404


def test_member_takes_a_test_on_a_published_bank_and_sees_only_their_own(
    client: TestClient, second_client: TestClient
) -> None:
    driving(client, publish=True)
    seed(client)
    bank = make_bank(client)
    admins = start(client, bank)
    theirs = second_client.post(f"/api/banks/{bank['id']}/exams")
    assert theirs.status_code == 201
    assert not has_key(theirs.json(), "answer")
    result = submit_as(second_client, theirs.json())
    assert result["passed"] is True
    ids = [e["id"] for e in second_client.get(f"/api/banks/{bank['id']}/exams").json()]
    assert ids == [theirs.json()["id"]]
    assert [e["id"] for e in client.get(f"/api/banks/{bank['id']}/exams").json()] == [admins["id"]]


def submit_as(client: TestClient, exam: dict[str, Any]) -> dict[str, Any]:
    response = submit(client, exam["id"], answers(exam))
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()["result"]
    return result


def test_a_private_bank_cannot_be_tested_by_another_user(
    client: TestClient, second_client: TestClient
) -> None:
    driving(client)
    bank = make_bank(client)
    assert second_client.post(f"/api/banks/{bank['id']}/exams").status_code == 404
    assert second_client.get(f"/api/banks/{bank['id']}/exams").status_code == 404
    assert client.post(f"/api/banks/{MISSING}/exams").status_code == 404


@pytest.mark.parametrize("payload", [{}, {"answers": [1]}, {"answers": {"x": "a"}}])
def test_malformed_answer_bodies_are_refused(client: TestClient, payload: dict[str, Any]) -> None:
    _, exam = exam_with(client)
    assert client.post(f"/api/exams/{exam['id']}/submit", json=payload).status_code == 422


def test_import_then_test_end_to_end_with_an_unseeded_draw(client: TestClient) -> None:
    driving(client)
    bank = upload(client, "driving-b", bank_doc()).json()
    exam = start(client, bank)
    assert len(exam["questions"]) == 10
