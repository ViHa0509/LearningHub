"""Spec: practice-exams - Import a question bank (and bank visibility, delete, images).

The banks here are small and made up; no real exam data.
"""

import io
import json
import zipfile
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from tests.test_learning_fields import make_area, make_field, put_topics

SLUG = "driving-b"
PNG = b"\x89PNG\r\n\x1a\n" + b"png-body" * 8
PNG2 = b"\x89PNG\r\n\x1a\n" + b"other-png" * 8
JPEG = b"\xff\xd8\xff\xe0" + b"jpeg-body" * 8
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"webp-body" * 4
TOPICS = ["chuong-1", "chuong-2", "chuong-3"]


def answer_of(number: int) -> int:
    """The correct option (1-based) of made-up question ``number``."""
    return number % 4 + 1


def make_questions(count: int = 20, critical: tuple[int, ...] = (19, 20)) -> list[dict[str, Any]]:
    """Questions 1..count; the topics come in thirds, every question has 4 options."""
    third = max(1, count // 3)
    out = []
    for n in range(1, count + 1):
        out.append(
            {
                "number": n,
                "topic": TOPICS[min((n - 1) // third, 2)],
                "text": f"Made-up question {n}?",
                "options": [f"Option {i} of {n}" for i in range(1, 5)],
                "answer": answer_of(n),
                "critical": n in critical,
                "explanation": f"Because {n}.",
            }
        )
    return out


RULES = {
    "questions": 10,
    "minutes": 20,
    "pass_mark": 8,
    "critical_fails": True,
    "min_critical": 1,
    "per_topic": {"chuong-1": 3},
}


def bank_doc(items: list[dict[str, Any]] | None = None, **rules: Any) -> dict[str, Any]:
    return {
        "title": "Made-up theory",
        "rules": {**RULES, **rules},
        "questions": make_questions() if items is None else items,
    }


def make_zip(
    doc: dict[str, Any] | bytes,
    images: dict[str, bytes] | None = None,
    json_name: str = "bank.json",
) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(json_name, doc if isinstance(doc, bytes) else json.dumps(doc))
        for name, data in (images or {}).items():
            archive.writestr(name, data)
    return out.getvalue()


def upload(client: TestClient, slug: str, data: bytes | dict[str, Any], name: str = "") -> Any:
    if isinstance(data, dict):
        data = json.dumps(data).encode()
    name = name or ("bank.zip" if data[:2] == b"PK" else "bank.json")
    return client.post(f"/api/areas/{slug}/banks", files={"file": (name, data)})


def driving(client: TestClient, slug: str = SLUG, publish: bool = False) -> str:
    """A field with the area ``slug`` and the topics chuong-1 to chuong-3; returns the field id."""
    field = make_field(client, "Licence")
    make_area(client, field["id"], slug)
    topics = [{"slug": t, "title": t.replace("-", " ").title()} for t in TOPICS]
    assert put_topics(client, slug, topics).status_code == 200
    if publish:
        assert client.patch(f"/api/fields/{field['id']}", json={"published": True}).is_success
    return str(field["id"])


def make_bank(client: TestClient, doc: dict[str, Any] | None = None, slug: str = SLUG) -> Any:
    response = upload(client, slug, doc or bank_doc())
    assert response.status_code == 201, response.text
    return response.json()


def stored_files(settings: Settings) -> list[Path]:
    return [p for p in (settings.storage_dir / "blobs").rglob("*") if p.is_file()]


def has_key(value: Any, key: str) -> bool:
    if isinstance(value, dict):
        return key in value or any(has_key(v, key) for v in value.values())
    if isinstance(value, list):
        return any(has_key(v, key) for v in value)
    return False


# --- Scenario: Import ---------------------------------------------------------------------


def test_import_a_zip_with_images_gives_a_bank_with_its_questions(
    client: TestClient, settings: Settings
) -> None:
    driving(client)
    questions = make_questions(12, critical=(4,))
    questions[0]["image"] = "q1.png"
    questions[1]["image"] = "images/q2.jpg"
    doc = bank_doc(questions, questions=10, per_topic={"chuong-1": 3}, pass_mark=8)
    response = upload(client, SLUG, make_zip(doc, {"q1.png": PNG, "images/q2.jpg": JPEG}))
    assert response.status_code == 201, response.text
    bank = response.json()
    assert bank["area"] == SLUG and bank["title"] == "Made-up theory"
    assert bank["question_count"] == 12 and bank["critical_count"] == 1
    assert bank["images_missing"] == 0
    assert bank["rules"] == {**RULES, "questions": 10, "per_topic": {"chuong-1": 3}}
    assert bank["topics"] == [
        {"slug": "chuong-1", "title": "Chuong 1", "count": 4},
        {"slug": "chuong-2", "title": "Chuong 2", "count": 4},
        {"slug": "chuong-3", "title": "Chuong 3", "count": 4},
    ]
    listed = client.get(f"/api/areas/{SLUG}/banks").json()
    assert [b["id"] for b in listed] == [bank["id"]]
    shown = client.get(f"/api/banks/{bank['id']}/questions").json()
    assert [q["number"] for q in shown] == list(range(1, 13))
    assert [q["has_image"] for q in shown[:3]] == [True, True, False]
    assert shown[0]["options"] == questions[0]["options"] and shown[3]["critical"] is True
    assert all(q["last_correct"] is None for q in shown)
    first = client.get(f"/api/questions/{shown[0]['id']}/image")
    assert first.status_code == 200 and first.content == PNG
    assert first.headers["content-type"] == "image/png"
    second = client.get(f"/api/questions/{shown[1]['id']}/image")
    assert second.content == JPEG and second.headers["content-type"] == "image/jpeg"
    assert client.get(f"/api/questions/{shown[2]['id']}/image").status_code == 404
    assert len(stored_files(settings)) == 2


def test_import_a_json_file_and_a_webp_image(client: TestClient) -> None:
    driving(client)
    questions = make_questions()
    questions[0]["image"] = "w.webp"
    bank = upload(client, SLUG, make_zip(bank_doc(questions), {"w.webp": WEBP}, "any.json")).json()
    shown = client.get(f"/api/banks/{bank['id']}/questions").json()
    image = client.get(f"/api/questions/{shown[0]['id']}/image")
    assert image.headers["content-type"] == "image/webp"
    plain = upload(client, SLUG, bank_doc(), "two.json")
    assert plain.status_code == 201 and plain.json()["question_count"] == 20
    assert len(client.get(f"/api/areas/{SLUG}/banks").json()) == 2


def test_no_response_about_a_bank_holds_the_answer(client: TestClient) -> None:
    driving(client)
    bank = make_bank(client)
    assert not has_key(bank, "answer")
    questions = client.get(f"/api/banks/{bank['id']}/questions").json()
    assert not has_key(questions, "answer") and not has_key(questions, "explanation")


# --- Scenario: Invalid bank ----------------------------------------------------------------


def bad_answer(doc: dict[str, Any]) -> None:
    doc["questions"][4]["answer"] = 5


def unknown_topic(doc: dict[str, Any]) -> None:
    doc["questions"][6]["topic"] = "chuong-9"


def duplicate_number(doc: dict[str, Any]) -> None:
    doc["questions"][7]["number"] = 3


def too_few_options(doc: dict[str, Any]) -> None:
    doc["questions"][2]["options"] = ["only one"]
    doc["questions"][2]["answer"] = 1


def long_text(doc: dict[str, Any]) -> None:
    doc["questions"][2]["text"] = "x" * 2001


def rules_beyond_the_bank(doc: dict[str, Any]) -> None:
    doc["rules"]["questions"] = 21


def rules_unknown_topic(doc: dict[str, Any]) -> None:
    doc["rules"]["per_topic"] = {"chuong-9": 2}


def rules_too_much(doc: dict[str, Any]) -> None:
    doc["rules"]["per_topic"] = {"chuong-1": 6, "chuong-2": 6}


def rules_pass_mark(doc: dict[str, Any]) -> None:
    doc["rules"]["pass_mark"] = 11


@pytest.mark.parametrize(
    ("change", "question", "words"),
    [
        (bad_answer, 5, "answer"),
        (unknown_topic, 7, "chuong-9"),
        (duplicate_number, 3, "twice"),
        (too_few_options, 3, "options"),
        (long_text, 3, "text"),
        (rules_beyond_the_bank, None, "questions"),
        (rules_unknown_topic, None, "chuong-9"),
        (rules_too_much, None, "per_topic"),
        (rules_pass_mark, None, "pass_mark"),
    ],
)
def test_invalid_bank_is_refused_naming_the_question_and_nothing_is_stored(
    client: TestClient,
    settings: Settings,
    change: Any,
    question: int | None,
    words: str,
) -> None:
    driving(client)
    doc = bank_doc()
    change(doc)
    response = upload(client, SLUG, doc)
    assert response.status_code == 422, response.text
    errors = response.json()["detail"]
    assert any(e["question"] == question and words in e["msg"] for e in errors), errors
    assert client.get(f"/api/areas/{SLUG}/banks").json() == []
    assert stored_files(settings) == []


def test_every_problem_is_reported_up_to_fifty(client: TestClient) -> None:
    driving(client)
    doc = bank_doc(make_questions(60, critical=(1,)), questions=10, per_topic={})
    for q in doc["questions"]:
        q["answer"] = 9
    errors = upload(client, SLUG, doc).json()["detail"]
    assert len(errors) == 50
    assert {e["question"] for e in errors} == set(range(1, 51))


def test_missing_image_and_bad_image_type_are_refused_and_store_nothing(
    client: TestClient, settings: Settings
) -> None:
    driving(client)
    questions = make_questions()
    questions[0]["image"] = "good.png"
    questions[1]["image"] = "missing.png"
    questions[2]["image"] = "fake.png"
    questions[3]["image"] = "script.svg"
    images = {"good.png": PNG, "fake.png": b"just text, not an image", "script.svg": b"<svg/>"}
    response = upload(client, SLUG, make_zip(bank_doc(questions), images))
    assert response.status_code == 422
    errors = {e["question"]: e["msg"] for e in response.json()["detail"]}
    assert "PNG, JPEG or WebP" in errors[3] and "PNG, JPEG or WebP" in errors[4]
    assert 1 not in errors and 2 not in errors  # a picture that is not there yet is no error
    assert client.get(f"/api/areas/{SLUG}/banks").json() == []
    assert stored_files(settings) == []


def test_an_image_named_in_a_json_only_import_is_kept_as_missing(client: TestClient) -> None:
    driving(client)
    questions = make_questions()
    questions[0]["image"] = "q1.png"
    questions[1]["image"] = "q2.png"
    response = upload(client, SLUG, bank_doc(questions))
    assert response.status_code == 201, response.text
    bank = response.json()
    assert bank["images_missing"] == 2
    shown = client.get(f"/api/banks/{bank['id']}/questions").json()
    assert [q["has_image"] for q in shown[:3]] == [False, False, False]
    assert client.get(f"/api/questions/{shown[0]['id']}/image").status_code == 404


def test_an_image_over_two_megabytes_is_refused(client: TestClient) -> None:
    driving(client)
    questions = make_questions()
    questions[0]["image"] = "big.png"
    big = PNG + b"\x00" * (2 * 1024 * 1024)
    response = upload(client, SLUG, make_zip(bank_doc(questions), {"big.png": big}))
    assert response.status_code == 422
    assert "2 MB" in response.json()["detail"][0]["msg"]


@pytest.mark.parametrize("name", ["../evil.png", "a/../../evil.png", "/abs/evil.png", "c:/x.png"])
def test_zip_with_an_unsafe_name_is_refused(client: TestClient, name: str) -> None:
    driving(client)
    response = upload(client, SLUG, make_zip(bank_doc(), {name: PNG}))
    assert response.status_code == 422, response.text
    assert "unsafe name" in response.json()["detail"][0]["msg"]
    assert client.get(f"/api/areas/{SLUG}/banks").json() == []


def test_zip_with_too_many_entries_or_two_json_files_is_refused(client: TestClient) -> None:
    driving(client)
    many = make_zip(bank_doc(), {f"i/{n}.png": b"x" for n in range(5001)})
    assert upload(client, SLUG, many).status_code == 422
    two = make_zip(bank_doc(), {"other.json": b"{}"})
    assert upload(client, SLUG, two).status_code == 422
    none = make_zip(bank_doc(), {})
    assert upload(client, SLUG, none).status_code == 201


def test_zip_that_expands_beyond_fifty_megabytes_is_refused(client: TestClient) -> None:
    driving(client)
    response = upload(client, SLUG, make_zip(bank_doc(), {"zeros.bin": b"\x00" * (51 * 1024**2)}))
    assert response.status_code == 413
    assert client.get(f"/api/areas/{SLUG}/banks").json() == []


def test_a_file_over_the_upload_limit_is_refused(client: TestClient, settings: Settings) -> None:
    driving(client)
    settings.max_upload_bytes = 500
    response = upload(client, SLUG, bank_doc())
    assert response.status_code == 413
    assert client.get(f"/api/areas/{SLUG}/banks").json() == []


@pytest.mark.parametrize(
    ("data", "name"),
    [
        (b"not json", "bank.json"),
        (b"[1, 2]", "bank.json"),
        (b"{}", "bank.json"),
        (b'{"title": "x", "rules": {}, "questions": []}', "bank.json"),
        (b"PK-not-a-zip", "bank.zip"),
        (b"<html></html>", "bank.html"),
    ],
)
def test_unreadable_files_are_refused(client: TestClient, data: bytes, name: str) -> None:
    driving(client)
    response = upload(client, SLUG, data, name)
    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["question"] is None


def test_import_needs_the_app_header_and_a_known_area(client: TestClient) -> None:
    driving(client)
    data = json.dumps(bank_doc()).encode()
    files = {"file": ("bank.json", data)}
    no_header = client.post(f"/api/areas/{SLUG}/banks", files=files, headers={"X-LearningHub": ""})
    assert no_header.status_code == 403
    assert upload(client, "nowhere", bank_doc()).status_code == 404


# --- Visibility and access ----------------------------------------------------------------------


def test_member_cannot_import_into_the_admins_published_area(
    client: TestClient, second_client: TestClient
) -> None:
    driving(client, publish=True)
    response = upload(second_client, SLUG, bank_doc())
    assert response.status_code == 403
    assert client.get(f"/api/areas/{SLUG}/banks").json() == []


def test_member_sees_the_banks_of_a_published_area_and_not_of_a_private_one(
    client: TestClient, second_client: TestClient
) -> None:
    driving(client)
    bank = make_bank(client)
    assert second_client.get(f"/api/areas/{SLUG}/banks").status_code == 404
    assert second_client.get(f"/api/banks/{bank['id']}/questions").status_code == 404
    assert upload(second_client, SLUG, bank_doc()).status_code == 404
    field_id = client.get("/api/fields").json()[1]["id"]
    client.patch(f"/api/fields/{field_id}", json={"published": True})
    seen = second_client.get(f"/api/areas/{SLUG}/banks")
    assert [b["id"] for b in seen.json()] == [bank["id"]]
    assert len(second_client.get(f"/api/banks/{bank['id']}/questions").json()) == 20
    refused = second_client.delete(f"/api/banks/{bank['id']}")
    assert refused.status_code == 403
    assert len(client.get(f"/api/areas/{SLUG}/banks").json()) == 1


def test_a_private_banks_image_is_not_served_to_another_user(
    client: TestClient, second_client: TestClient
) -> None:
    driving(client)
    questions = make_questions()
    questions[0]["image"] = "q.png"
    bank = upload(client, SLUG, make_zip(bank_doc(questions), {"q.png": PNG})).json()
    first = client.get(f"/api/banks/{bank['id']}/questions").json()[0]["id"]
    assert client.get(f"/api/questions/{first}/image").status_code == 200
    assert second_client.get(f"/api/questions/{first}/image").status_code == 404


def test_built_in_roadmaps_hold_no_banks(client: TestClient) -> None:
    built_in = client.get("/api/fields").json()[0]["areas"][0]["id"]
    assert client.get(f"/api/areas/{built_in}/banks").json() == []
    assert upload(client, built_in, bank_doc()).status_code == 403


def test_unknown_bank_ids_answer_not_found(client: TestClient) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    for path in (f"/api/banks/{missing}/questions", f"/api/questions/{missing}/image"):
        assert client.get(path).status_code == 404
    assert client.get("/api/banks/not-a-uuid/questions").status_code == 404
    assert client.delete(f"/api/banks/{missing}").status_code == 404


# --- Filters and delete ------------------------------------------------------------------------


def test_question_filters_combine(client: TestClient) -> None:
    driving(client)
    bank = make_bank(client)
    url = f"/api/banks/{bank['id']}/questions"

    def numbers(**query: str) -> list[int]:
        return [x["number"] for x in client.get(url, params=query).json()]

    assert numbers(topic="chuong-1") == [1, 2, 3, 4, 5, 6]
    assert numbers(critical="true") == [19, 20]
    assert numbers(topic="chuong-3", critical="true") == [19, 20]
    assert numbers(topic="chuong-1", critical="true") == []
    assert numbers(wrong="true") == []


def test_delete_removes_the_bank_its_tests_and_unshared_images(
    client: TestClient, settings: Settings
) -> None:
    driving(client)
    questions = make_questions()
    questions[0]["image"] = "a.png"
    questions[1]["image"] = "b.png"
    shared = {"a.png": PNG, "b.png": PNG2}
    first = upload(client, SLUG, make_zip(bank_doc(questions), shared)).json()
    # A second bank uses the first image again: that file must survive the first delete.
    questions2 = make_questions()
    questions2[5]["image"] = "same.png"
    second = upload(client, SLUG, make_zip(bank_doc(questions2), {"same.png": PNG})).json()
    assert len(stored_files(settings)) == 2  # content-addressed: PNG is stored once
    exam = client.post(f"/api/banks/{first['id']}/exams")
    assert exam.status_code == 201
    assert client.delete(f"/api/banks/{first['id']}").status_code == 204
    assert [b["id"] for b in client.get(f"/api/areas/{SLUG}/banks").json()] == [second["id"]]
    assert client.get(f"/api/exams/{exam.json()['id']}").status_code == 404
    assert len(stored_files(settings)) == 1
    qid = client.get(f"/api/banks/{second['id']}/questions").json()[5]["id"]
    assert client.get(f"/api/questions/{qid}/image").content == PNG
    assert client.delete(f"/api/banks/{second['id']}").status_code == 204
    assert stored_files(settings) == []


def test_delete_needs_the_app_header(client: TestClient) -> None:
    driving(client)
    bank = make_bank(client)
    assert (
        client.delete(f"/api/banks/{bank['id']}", headers={"X-LearningHub": ""}).status_code == 403
    )


def bank_with_pictures(client: TestClient, slug: str = SLUG) -> dict[str, Any]:
    questions = make_questions()
    questions[0]["image"] = "a.png"
    questions[1]["image"] = "b.png"
    response = upload(client, slug, make_zip(bank_doc(questions), {"a.png": PNG, "b.png": PNG2}))
    assert response.status_code == 201, response.text
    return dict(response.json())


def test_deleting_the_area_deletes_its_banks_and_their_pictures(
    client: TestClient, settings: Settings
) -> None:
    driving(client)
    bank = bank_with_pictures(client)
    assert len(stored_files(settings)) == 2
    assert client.delete(f"/api/areas/{SLUG}").status_code == 204
    assert client.get(f"/api/banks/{bank['id']}/questions").status_code == 404
    assert stored_files(settings) == []


def test_deleting_the_field_releases_the_pictures_unless_another_bank_uses_them(
    client: TestClient, settings: Settings
) -> None:
    field_id = driving(client)
    bank_with_pictures(client)
    other = make_field(client, "Other")
    make_area(client, other["id"], "second-area")
    put_topics(client, "second-area", [{"slug": t, "title": t} for t in TOPICS])
    questions = make_questions()
    questions[0]["image"] = "a.png"
    upload(client, "second-area", make_zip(bank_doc(questions), {"a.png": PNG}))
    assert len(stored_files(settings)) == 2
    assert client.delete(f"/api/fields/{field_id}").status_code == 204
    assert len(stored_files(settings)) == 1  # PNG is still used by the other field's bank
    assert client.delete(f"/api/fields/{other['id']}").status_code == 204
    assert stored_files(settings) == []


# --- Questions first, pictures after ----------------------------------------------------------


def pictures_bank(client: TestClient) -> dict[str, Any]:
    """A JSON-only bank whose questions 1, 2, 3 name pictures (3 shares the name of 1)."""
    questions = make_questions()
    questions[0]["image"] = "q1.png"
    questions[1]["image"] = "images/q2.jpg"
    questions[2]["image"] = "q1.png"
    response = upload(client, SLUG, bank_doc(questions))
    assert response.status_code == 201, response.text
    return dict(response.json())


def add(client: TestClient, bank_id: str, *files: tuple[str, bytes]) -> Any:
    return client.post(f"/api/banks/{bank_id}/images", files=[("files", f) for f in files])


def has_image(client: TestClient, bank_id: str) -> dict[int, bool]:
    shown = client.get(f"/api/banks/{bank_id}/questions").json()
    return {q["number"]: q["has_image"] for q in shown[:4]}


# Scenario: Questions first, pictures after
def test_pictures_are_added_in_batches_and_each_upload_says_what_is_missing(
    client: TestClient, settings: Settings
) -> None:
    driving(client)
    bank = pictures_bank(client)
    assert bank["images_missing"] == 3
    first = add(client, bank["id"], ("q1.png", PNG), ("nobody.png", PNG2))
    assert first.status_code == 200, first.text
    assert first.json() == {"added": ["q1.png"], "unknown": ["nobody.png"], "missing": 1}
    assert has_image(client, bank["id"]) == {1: True, 2: False, 3: True, 4: False}
    second = add(client, bank["id"], ("q2.jpg", JPEG))  # matched by file name
    assert second.json() == {"added": ["q2.jpg"], "unknown": [], "missing": 0}
    assert has_image(client, bank["id"]) == {1: True, 2: True, 3: True, 4: False}
    assert client.get(f"/api/areas/{SLUG}/banks").json()[0]["images_missing"] == 0
    shown = client.get(f"/api/banks/{bank['id']}/questions").json()
    assert client.get(f"/api/questions/{shown[0]['id']}/image").content == PNG
    assert client.get(f"/api/questions/{shown[2]['id']}/image").content == PNG
    assert client.get(f"/api/questions/{shown[1]['id']}/image").content == JPEG
    assert len(stored_files(settings)) == 2


def test_pictures_can_come_in_a_zip_and_with_image_files_together(client: TestClient) -> None:
    driving(client)
    bank = pictures_bank(client)
    inner = {"images/q2.jpg": JPEG, "readme.txt": b"hi", "q9.png": PNG2}
    archive = make_zip(b"{}", inner, "x.json")
    response = add(client, bank["id"], ("pics.zip", archive), ("q1.png", PNG))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["added"] == ["q1.png", "q2.jpg"] and body["missing"] == 0
    assert body["unknown"] == ["q9.png", "readme.txt", "x.json"]


def test_a_name_sent_again_replaces_the_picture_and_releases_the_old_file(
    client: TestClient, settings: Settings
) -> None:
    driving(client)
    bank = pictures_bank(client)
    add(client, bank["id"], ("q1.png", PNG))
    assert len(stored_files(settings)) == 1
    again = add(client, bank["id"], ("q1.png", PNG2))
    assert again.json() == {"added": ["q1.png"], "unknown": [], "missing": 1}
    assert len(stored_files(settings)) == 1  # the old, unused file is gone
    shown = client.get(f"/api/banks/{bank['id']}/questions").json()
    assert client.get(f"/api/questions/{shown[0]['id']}/image").content == PNG2
    same = add(client, bank["id"], ("q1.png", PNG2))  # identical bytes: nothing breaks
    assert same.status_code == 200 and len(stored_files(settings)) == 1


def test_a_replaced_picture_stays_when_another_bank_still_uses_it(
    client: TestClient, settings: Settings
) -> None:
    driving(client)
    bank = pictures_bank(client)
    add(client, bank["id"], ("q1.png", PNG))
    other = bank_with_pictures(client)  # its a.png has the same bytes
    assert len(stored_files(settings)) == 2
    add(client, bank["id"], ("q1.png", PNG2))
    shown = client.get(f"/api/banks/{other['id']}/questions").json()
    assert client.get(f"/api/questions/{shown[0]['id']}/image").content == PNG


def test_a_bad_picture_stops_the_whole_upload(client: TestClient, settings: Settings) -> None:
    driving(client)
    bank = pictures_bank(client)
    response = add(client, bank["id"], ("q1.png", PNG), ("q2.jpg", b"not an image"))
    assert response.status_code == 422
    assert response.json()["detail"][0]["question"] == 2
    big = add(client, bank["id"], ("q1.png", PNG + b"\x00" * (2 * 1024 * 1024)))
    assert big.status_code == 422 and "2 MB" in big.json()["detail"][0]["msg"]
    assert has_image(client, bank["id"]) == {1: False, 2: False, 3: False, 4: False}
    assert stored_files(settings) == []


def test_an_unsafe_zip_of_pictures_is_refused(client: TestClient) -> None:
    driving(client)
    bank = pictures_bank(client)
    evil = make_zip(b"{}", {"../q1.png": PNG}, "x.json")
    assert add(client, bank["id"], ("p.zip", evil)).status_code == 422
    assert add(client, bank["id"], ("p.zip", b"PK-broken")).status_code == 422


def test_only_the_owner_adds_pictures(client: TestClient, second_client: TestClient) -> None:
    driving(client)
    bank = pictures_bank(client)
    assert add(second_client, bank["id"], ("q1.png", PNG)).status_code == 404
    field_id = client.get("/api/fields").json()[1]["id"]
    client.patch(f"/api/fields/{field_id}", json={"published": True})
    assert add(second_client, bank["id"], ("q1.png", PNG)).status_code == 403
    off = {"X-LearningHub": ""}
    no_header = client.post(
        f"/api/banks/{bank['id']}/images", files=[("files", ("q1.png", PNG))], headers=off
    )
    assert no_header.status_code == 403
    assert has_image(client, bank["id"])[1] is False
    missing = "00000000-0000-0000-0000-000000000000"
    assert add(client, missing, ("q1.png", PNG)).status_code == 404
