"""Spec: data-sync - Question banks in the backup (data/question_banks.json)."""

import io
import json
import zipfile
from typing import Any

from fastapi.testclient import TestClient

from app.config import Settings
from tests.test_data_backup import download, restore, rewrite
from tests.test_exams import answers, seed, start, submit
from tests.test_question_banks import (
    PNG,
    SLUG,
    answer_of,
    bank_doc,
    driving,
    make_questions,
    make_zip,
    stored_files,
    upload,
)

BANKS = "data/question_banks.json"
FIELDS = "data/learning_fields.json"


def seed_bank(client: TestClient) -> dict[str, Any]:
    """A bank of 20 questions (one with an image), one wrong practice answer and a finished
    test with one wrong answer."""
    driving(client)
    seed(client)
    questions = make_questions()
    questions[0]["image"] = "q1.png"
    bank = upload(client, SLUG, make_zip(bank_doc(questions), {"q1.png": PNG})).json()
    first = client.get(f"/api/banks/{bank['id']}/questions").json()[0]
    client.post(f"/api/questions/{first['id']}/answer", json={"choice": 4})
    exam = start(client, bank)
    wrong = exam["questions"][1]["number"]
    assert submit(client, exam["id"], answers(exam, wrong=(wrong,))).status_code == 200
    started = start(client, bank)  # a second, unfinished test
    assert started["submitted_at"] is None
    bank["wrong"] = wrong
    return dict(bank)


def shape(client: TestClient) -> dict[str, Any]:
    """Everything a user sees of the banks, without ids."""
    out: dict[str, Any] = {}
    listed = client.get(f"/api/areas/{SLUG}/banks")
    for bank in listed.json() if listed.status_code == 200 else []:
        questions = client.get(f"/api/banks/{bank['id']}/questions").json()
        number = {q["id"]: q["number"] for q in questions}
        images = {
            q["number"]: client.get(f"/api/questions/{q['id']}/image").content
            for q in questions
            if q["has_image"]
        }
        exams = []
        for summary in client.get(f"/api/banks/{bank['id']}/exams").json():
            detail = client.get(f"/api/exams/{summary['id']}").json()
            result = detail["result"]
            exams.append(
                (
                    summary["started_at"],
                    summary["submitted_at"],
                    summary["score"],
                    summary["passed"],
                    summary["total"],
                    [q["number"] for q in detail["questions"]],
                    {number[k]: v for k, v in detail["answers"].items()},
                    detail["deadline"],
                    None
                    if result is None
                    else (
                        result["failed_on_critical"],
                        [(r["number"], r["choice"]) for r in result["review"]],
                    ),
                )
            )
        wrong = client.get(f"/api/banks/{bank['id']}/questions", params={"wrong": "true"}).json()
        out[bank["title"]] = {
            "bank": {k: v for k, v in bank.items() if k != "id"},
            "questions": [
                (q["number"], q["topic"], q["text"], q["options"], q["critical"], q["last_correct"])
                for q in questions
            ],
            "images": images,
            "exams": exams,
            "wrong": [q["number"] for q in wrong],
        }
    return out


def test_backup_holds_the_banks_with_their_images(client: TestClient) -> None:
    seed_bank(client)
    archive = zipfile.ZipFile(io.BytesIO(download(client)))
    counts = json.loads(archive.read("manifest.json"))["counts"]
    assert counts["question_banks"] == 1 and counts["questions"] == 20
    assert counts["question_answers"] in (10, 11) and counts["exam_attempts"] == 2
    data = json.loads(archive.read(BANKS))
    assert len(data) == 1 and data[0]["area_slug"] == SLUG and len(data[0]["questions"]) == 20
    assert "id" not in data[0] and "id" not in data[0]["questions"][0]
    key = data[0]["questions"][0]["image_key"]
    assert key.startswith("blobs/") and key.endswith(".png")
    assert archive.read(f"files/{key}") == PNG
    assert data[0]["questions"][1]["image_key"] is None


# Scenario: Round trip
def test_round_trip_brings_back_the_bank_its_image_and_the_tests(
    client: TestClient, settings: Settings
) -> None:
    seed_bank(client)
    before = shape(client)
    backup = download(client)
    field_id = client.get("/api/fields").json()[1]["id"]
    assert client.delete(f"/api/fields/{field_id}").status_code == 204
    assert shape(client) == {}
    response = restore(client, backup)
    assert response.status_code == 200, response.text
    counts = response.json()["counts"]
    assert (counts["question_banks"], counts["questions"], counts["exam_attempts"]) == (1, 20, 2)
    after = shape(client)
    assert after == before
    bank = after["Made-up theory"]
    assert bank["images"] == {1: PNG} and bank["wrong"] != []
    assert len(bank["exams"]) == 2 and len(stored_files(settings)) == 1


def test_a_restored_test_can_be_reviewed_and_the_bank_practised(client: TestClient) -> None:
    seed_bank(client)
    backup = download(client)
    field_id = client.get("/api/fields").json()[1]["id"]
    client.delete(f"/api/fields/{field_id}")
    assert restore(client, backup).status_code == 200
    bank = client.get(f"/api/areas/{SLUG}/banks").json()[0]
    history = client.get(f"/api/banks/{bank['id']}/exams").json()
    unfinished = next(e for e in history if e["submitted_at"] is None)
    detail = client.get(f"/api/exams/{unfinished['id']}").json()
    done = submit(client, detail["id"], answers(detail))
    assert done.json()["result"]["total"] == 10
    questions = client.get(f"/api/banks/{bank['id']}/questions").json()
    qid = next(q["id"] for q in questions if q["number"] == 2)
    right = client.post(f"/api/questions/{qid}/answer", json={"choice": answer_of(2)})
    assert right.json()["correct"] is True


def test_restore_replaces_the_banks_made_after_the_backup(
    client: TestClient, settings: Settings
) -> None:
    first = seed_bank(client)
    before = shape(client)
    backup = download(client)
    assert client.delete(f"/api/banks/{first['id']}").status_code == 204
    assert stored_files(settings) == []  # the image was released with the bank
    later = bank_doc()
    later["title"] = "Later bank"
    assert upload(client, SLUG, later).status_code == 201
    assert restore(client, backup).status_code == 200
    assert shape(client) == before
    assert len(stored_files(settings)) == 1


def test_archive_without_a_banks_entry_leaves_the_banks(client: TestClient) -> None:
    seed_bank(client)
    before = shape(client)
    old = rewrite(download(client), lambda entries: (entries.pop(BANKS), entries.pop(FIELDS)))
    response = restore(client, old)
    assert response.status_code == 200, response.text
    assert "question_banks" not in response.json()["counts"]
    assert shape(client) == before


def test_an_archive_with_banks_but_no_fields_entry_replaces_only_the_banks(
    client: TestClient,
) -> None:
    first = seed_bank(client)
    before = shape(client)
    backup = rewrite(download(client), lambda entries: entries.pop(FIELDS))
    client.delete(f"/api/banks/{first['id']}")
    response = restore(client, backup)
    assert response.status_code == 200, response.text
    assert shape(client) == before


def test_a_member_backup_holds_only_their_own_banks(
    client: TestClient, second_client: TestClient
) -> None:
    seed_bank(client)
    field_id = client.get("/api/fields").json()[1]["id"]
    client.patch(f"/api/fields/{field_id}", json={"published": True})
    qid = second_client.get(
        f"/api/banks/{client.get(f'/api/areas/{SLUG}/banks').json()[0]['id']}/questions"
    ).json()[0]["id"]
    second_client.post(f"/api/questions/{qid}/answer", json={"choice": 1})
    archive = zipfile.ZipFile(io.BytesIO(download(second_client)))
    assert json.loads(archive.read(BANKS)) == []
    counts = json.loads(archive.read("manifest.json"))["counts"]
    assert "question_banks" not in counts and "exam_attempts" not in counts


# --- Refusals leave everything as it is -----------------------------------------------------------


def broken_area(entries: dict[str, bytes]) -> None:
    data = json.loads(entries[BANKS])
    data[0]["area_slug"] = "no-such-area"
    entries[BANKS] = json.dumps(data).encode()


def broken_answer(entries: dict[str, bytes]) -> None:
    data = json.loads(entries[BANKS])
    data[0]["questions"][3]["answer"] = 5
    entries[BANKS] = json.dumps(data).encode()


def broken_attempt(entries: dict[str, bytes]) -> None:
    data = json.loads(entries[BANKS])
    data[0]["attempts"][0]["question_numbers"][0] = 99
    entries[BANKS] = json.dumps(data).encode()


def broken_rules(entries: dict[str, bytes]) -> None:
    data = json.loads(entries[BANKS])
    data[0]["rules"] = {"questions": "ten"}
    entries[BANKS] = json.dumps(data).encode()


def duplicate_number(entries: dict[str, bytes]) -> None:
    data = json.loads(entries[BANKS])
    data[0]["questions"][3]["number"] = 1
    entries[BANKS] = json.dumps(data).encode()


def missing_image(entries: dict[str, bytes]) -> None:
    for name in [n for n in entries if n.startswith("files/")]:
        del entries[name]


def test_an_invalid_banks_entry_is_refused_and_changes_nothing(client: TestClient) -> None:
    seed_bank(client)
    before = shape(client)
    backup = download(client)
    for change in (
        broken_area,
        broken_answer,
        broken_attempt,
        broken_rules,
        duplicate_number,
        missing_image,
    ):
        response = restore(client, rewrite(backup, change))
        assert response.status_code == 422, (change.__name__, response.text)
        assert shape(client) == before


def test_questions_without_uploaded_pictures_round_trip_and_can_get_them_later(
    client: TestClient, settings: Settings
) -> None:
    driving(client)
    questions = make_questions()
    questions[0]["image"] = "q1.png"
    questions[1]["image"] = "q2.png"
    bank = upload(client, SLUG, bank_doc(questions)).json()
    client.post(f"/api/banks/{bank['id']}/images", files=[("files", ("q1.png", PNG))])
    before = shape(client)
    backup = download(client)
    archive = zipfile.ZipFile(io.BytesIO(backup))
    data = json.loads(archive.read(BANKS))[0]["questions"]
    assert data[0]["image_name"] == "q1.png" and data[0]["image_key"] is not None
    assert data[1]["image_name"] == "q2.png" and data[1]["image_key"] is None
    field_id = client.get("/api/fields").json()[1]["id"]
    client.delete(f"/api/fields/{field_id}")
    assert stored_files(settings) == []
    assert restore(client, backup).status_code == 200
    assert shape(client) == before
    restored = client.get(f"/api/areas/{SLUG}/banks").json()[0]
    assert restored["images_missing"] == 1
    late = client.post(f"/api/banks/{restored['id']}/images", files=[("files", ("q2.png", PNG))])
    assert late.json() == {"added": ["q2.png"], "unknown": [], "missing": 0}


def test_an_old_archive_without_image_names_still_restores(client: TestClient) -> None:
    seed_bank(client)
    backup = download(client)

    def strip(entries: dict[str, bytes]) -> None:
        data = json.loads(entries[BANKS])
        for question in data[0]["questions"]:
            question.pop("image_name", None)
        entries[BANKS] = json.dumps(data).encode()

    assert restore(client, rewrite(backup, strip)).status_code == 200
    bank = client.get(f"/api/areas/{SLUG}/banks").json()[0]
    assert bank["images_missing"] == 0
