"""Spec: a2ui-chat - Surfaces come from templates and carry no answers; Grade an answer
(the result messages)."""

import json
from typing import Any

from app.a2ui.content import LessonContent, QuizContent
from app.a2ui.templates import (
    BASIC_COMPONENT_TYPES,
    CATALOG_ID,
    answer_key_for,
    build_lesson,
    build_quiz,
    grade_messages,
    score_text,
)

SURFACE = "a2ui-1234"


def make_question(n: int) -> dict[str, Any]:
    return {
        "text": f"Question text {n}?",
        "options": [f"Choice {n}-{i}" for i in range(1, 5)],
        "answer": (n % 4) + 1,
        "explanation": f"SECRET-EXPLANATION-{n} because reasons.",
    }


def quiz(count: int = 5) -> QuizContent:
    return QuizContent.model_validate(
        {"title": "Docker", "questions": [make_question(n) for n in range(1, count + 1)]}
    )


def lesson() -> LessonContent:
    return LessonContent.model_validate(
        {
            "title": "Containers",
            "sections": [
                {"kind": "concept", "heading": "Image", "body": "An **image**."},
                {"kind": "example", "heading": "Run", "body": "`docker run`"},
                {"kind": "tip", "heading": "Tip", "body": "Keep images small."},
                {"kind": "check", "heading": "Check", "question": make_question(1)},
                {"kind": "check", "heading": "Again", "question": make_question(2)},
            ],
        }
    )


def components_of(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    found = [m["updateComponents"]["components"] for m in messages if "updateComponents" in m]
    assert len(found) == 1
    out: list[dict[str, Any]] = found[0]
    return out


def by_id(messages: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {c["id"]: c for c in components_of(messages)}


def test_envelope_is_create_then_components_then_data() -> None:
    messages = build_quiz(SURFACE, quiz())
    assert [next(k for k in m if k != "version") for m in messages] == [
        "createSurface",
        "updateComponents",
        "updateDataModel",
    ]
    assert all(m["version"] == "v0.9" for m in messages)
    assert messages[0]["createSurface"] == {"surfaceId": SURFACE, "catalogId": CATALOG_ID}
    assert CATALOG_ID == "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
    assert messages[1]["updateComponents"]["surfaceId"] == SURFACE
    assert messages[2]["updateDataModel"]["surfaceId"] == SURFACE
    assert messages[2]["updateDataModel"]["path"] == "/"


def test_messages_hold_no_answer_and_no_explanation() -> None:
    content = quiz()
    for messages in (build_quiz(SURFACE, content), build_lesson(SURFACE, lesson())):
        text = json.dumps(messages)
        assert "SECRET-EXPLANATION" not in text
        assert "explanation" not in text
        assert "answer" not in text.replace("check_answer", "").replace("answered", "")
        assert '"correct"' not in text
    # The key itself does hold them, on the server.
    key = answer_key_for(content)
    assert key["q1"]["answer"] == 2 and "SECRET-EXPLANATION-1" in key["q1"]["explanation"]
    assert key["q1"]["options"][0] == "Choice 1-1"


def test_component_ids_are_unique_with_one_root_and_all_types_in_the_catalog() -> None:
    for messages in (build_quiz(SURFACE, quiz()), build_lesson(SURFACE, lesson())):
        components = components_of(messages)
        ids = [c["id"] for c in components]
        assert len(ids) == len(set(ids)) and ids.count("root") == 1
        assert {c["component"] for c in components} <= BASIC_COMPONENT_TYPES
        known = set(ids)
        for c in components:
            children = c.get("children", [])
            for child in children if isinstance(children, list) else []:
                assert child in known
            ref = c.get("child")
            assert ref is None or ref in known


def test_question_components_have_explicit_ids_and_bindings() -> None:
    comps = by_id(build_quiz(SURFACE, quiz(), images={"q2": "/api/questions/abc/image"}))
    for n in range(1, 6):
        for suffix in ("card", "text", "choice", "check", "feedback"):
            assert f"q{n}-{suffix}" in comps
    assert "q1-image" not in comps and comps["q2-image"]["component"] == "Image"
    assert comps["q2-image"]["url"] == {"path": "/questions/q2/image"}
    choice = comps["q3-choice"]
    assert choice["component"] == "ChoicePicker"
    assert choice["value"] == {"path": "/questions/q3/choice"}
    assert choice["options"][0] == {
        "label": {"path": "/questions/q3/options/0/label"},
        "value": "1",
    }
    assert [o["value"] for o in choice["options"]] == ["1", "2", "3", "4"]
    assert comps["q3-mark"]["text"] == {"path": "/questions/q3/mark"}
    column = comps["q3-body"]["children"]
    assert column.index("q3-mark") == column.index("q3-feedback") - 1
    assert comps["q3-feedback"]["text"] == {"path": "/questions/q3/feedback"}
    assert comps["score"]["text"] == {"path": "/score/text"}


def test_check_button_action_and_context_shape() -> None:
    comps = by_id(build_quiz(SURFACE, quiz()))
    button = comps["q2-check"]
    assert button["component"] == "Button" and button["child"] == "q2-check-label"
    assert comps["q2-check-label"]["text"] == "Check"
    assert button["action"] == {
        "event": {
            "name": "check_answer",
            "context": {"question": "q2", "choice": {"path": "/questions/q2/choice"}},
        }
    }


def test_data_model_shape() -> None:
    messages = build_quiz(SURFACE, quiz(), images={"q1": "/api/questions/x/image"})
    data = messages[2]["updateDataModel"]["value"]
    assert data["title"] == "Docker"
    assert data["score"] == {"text": "0 / 5 answered, 0 correct"}
    q1 = data["questions"]["q1"]
    assert q1["text"] == "Question text 1?" and q1["choice"] == [] and q1["status"] == "open"
    assert q1["mark"] == "" and q1["feedback"] == "" and q1["image"] == "/api/questions/x/image"
    assert "image" not in data["questions"]["q2"]
    assert q1["options"][3] == {"label": "Choice 1-4", "value": "4"}


def test_at_most_ten_questions() -> None:
    comps = by_id(build_quiz(SURFACE, quiz(count=10)))
    assert "q10-card" in comps and "q11-card" not in comps
    capped = QuizContent.model_construct(title="Big", questions=quiz(10).questions * 2)
    messages = build_quiz(SURFACE, capped)
    assert "q11-card" not in by_id(messages)
    assert len(messages[2]["updateDataModel"]["value"]["questions"]) == 10
    assert len(answer_key_for(capped)) == 10


def test_lesson_sections_in_order_with_check_questions() -> None:
    messages = build_lesson(SURFACE, lesson())
    comps = by_id(messages)
    assert comps["root"]["children"] == [
        "title",
        "s1-card",
        "s2-card",
        "s3-card",
        "s4-card",
        "s5-card",
        "score",
    ]
    assert comps["s1-kind"]["text"] == "Concept" and comps["s1-body"]["text"] == "An **image**."
    assert comps["s4-kind"]["text"] == "Check yourself"
    assert "q1-choice" in comps and "q2-check" in comps and "s4-body" not in comps
    assert comps["s4-column"]["children"][2:] == [
        "q1-text",
        "q1-choice",
        "q1-check",
        "q1-mark",
        "q1-feedback",
    ]
    data = messages[2]["updateDataModel"]["value"]
    assert set(data["questions"]) == {"q1", "q2"}
    assert data["score"]["text"] == "0 / 2 answered, 0 correct"
    key = answer_key_for(lesson())
    assert set(key) == {"q1", "q2"} and key["q2"]["answer"] == 3


def test_a_lesson_without_checks_has_no_questions_or_score() -> None:
    plain = LessonContent.model_validate(
        {
            "title": "Plain",
            "sections": [{"kind": "concept", "heading": f"H{i}", "body": "text"} for i in range(3)],
        }
    )
    messages = build_lesson(SURFACE, plain)
    assert "score" not in by_id(messages)
    assert messages[2]["updateDataModel"]["value"] == {"title": "Plain"}
    assert answer_key_for(plain) == {}


def test_grade_messages_wrong_and_right() -> None:
    wrong = grade_messages(
        SURFACE, "q2", "Choice 2-1", False, "Because.", "1 / 5 answered, 0 correct"
    )
    assert [m["updateDataModel"]["path"] for m in wrong] == [
        "/questions/q2/status",
        "/questions/q2/mark",
        "/questions/q2/feedback",
        "/score/text",
    ]
    assert [m["updateDataModel"]["value"] for m in wrong] == [
        "wrong",
        "✗ Not quite",
        'Not quite. The answer is "Choice 2-1". Because.',
        "1 / 5 answered, 0 correct",
    ]
    marked = grade_messages(SURFACE, "q2", "Choice 2-3", False, "Because.", "s", option_number=3)
    label = next(m for m in marked if m["updateDataModel"]["path"].endswith("/label"))
    assert label["updateDataModel"] == {
        "surfaceId": SURFACE,
        "path": "/questions/q2/options/2/label",
        "value": "Choice 2-3 ✓",
    }
    assert all(
        m["version"] == "v0.9" and m["updateDataModel"]["surfaceId"] == SURFACE for m in wrong
    )
    right = grade_messages(SURFACE, "q2", "Choice 2-1", True, "Because.", score_text(1, 5, 1))
    assert right[0]["updateDataModel"]["value"] == "correct"
    assert right[1]["updateDataModel"]["value"] == "✓ Correct"
    assert right[2]["updateDataModel"]["value"] == "Correct. Because."
    assert right[-1]["updateDataModel"]["value"] == "1 / 5 answered, 1 correct"
