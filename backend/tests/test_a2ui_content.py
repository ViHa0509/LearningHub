"""Spec: a2ui-chat - Generated quiz, Creative lesson (content limits and readable reasons)."""

import copy
import json
from typing import Any

from app.a2ui.content import LessonContent, QuizContent, parse_lesson, parse_quiz


def question(**changes: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "text": "Which command lists running containers?",
        "options": ["docker ps", "docker run", "docker pull", "docker rm"],
        "answer": 1,
        "explanation": "docker ps lists running containers.",
    }
    return {**base, **changes}


def quiz(count: int = 3, **changes: Any) -> dict[str, Any]:
    return {"title": "Docker basics", "questions": [question() for _ in range(count)], **changes}


def lesson(**changes: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "title": "Containers",
        "sections": [
            {"kind": "concept", "heading": "Image", "body": "An **image** is a template."},
            {"kind": "example", "heading": "Run", "body": "`docker run nginx`"},
            {"kind": "check", "heading": "Check yourself", "question": question()},
        ],
    }
    return {**base, **changes}


def reason(data: dict[str, Any]) -> str:
    result = parse_quiz(data)
    assert isinstance(result, str), "expected a refusal"
    return result


def test_a_valid_quiz_is_accepted() -> None:
    result = parse_quiz(quiz(count=10))
    assert isinstance(result, QuizContent) and len(result.questions) == 10


def test_a_valid_lesson_is_accepted() -> None:
    result = parse_lesson(lesson())
    assert isinstance(result, LessonContent)
    assert [s.kind for s in result.sections] == ["concept", "example", "check"]


def test_one_option_is_refused_with_its_question_number() -> None:
    data = quiz()
    data["questions"][1] = question(options=["only"], answer=1)
    assert reason(data) == "question 2 has 1 option; give 2 to 6"


def test_seven_options_are_refused() -> None:
    data = quiz()
    data["questions"][0] = question(options=[f"o{i}" for i in range(7)])
    assert reason(data) == "question 1 has 7 options; give 2 to 6"


def test_an_answer_out_of_range_is_refused() -> None:
    data = quiz()
    data["questions"][2] = question(answer=5)
    assert reason(data) == "question 3: answer 5 is out of range 1-4"
    data["questions"][2] = question(answer=0)
    assert reason(data) == "question 3: answer 0 is out of range 1-4"


def test_two_and_eleven_questions_are_refused() -> None:
    assert reason(quiz(count=2)) == "the content has 2 questions; give 3 to 10"
    assert reason(quiz(count=11)) == "the content has 11 questions; give 3 to 10"


def test_text_limits_are_refused_with_the_place() -> None:
    data = quiz()
    data["questions"][0] = question(text="x" * 601)
    assert reason(data).startswith("question 1 text:")
    assert reason(quiz(title="t" * 121)).startswith("title:")
    data["questions"][0] = question(explanation="e" * 801)
    assert reason(data).startswith("question 1 explanation:")
    data["questions"][0] = question(options=["a", "b" * 201])
    assert reason(data) == "question 1 options: option 2 has 201 characters; the limit is 200"


def test_a_url_or_image_field_is_refused() -> None:
    data = quiz()
    data["questions"][0]["image"] = "https://tracker.example/p.png"
    assert "Extra inputs are not permitted" in reason(data)


def test_a_check_section_without_a_question_is_refused() -> None:
    data = lesson()
    del data["sections"][2]["question"]
    result = parse_lesson(data)
    assert result == "section 3: a check section needs a question"


def test_a_concept_section_without_a_body_is_refused() -> None:
    data = lesson()
    del data["sections"][0]["body"]
    assert parse_lesson(data) == "section 1: a concept section needs a body"


def test_a_check_question_has_the_quiz_question_limits() -> None:
    data = lesson()
    data["sections"][2]["question"] = question(answer=9)
    assert parse_lesson(data) == "section 3 question: answer 9 is out of range 1-4"


def test_lesson_section_counts_and_limits() -> None:
    short = lesson()
    short["sections"] = short["sections"][:2]
    assert parse_lesson(short) == "the content has 2 sections; give 3 to 8"
    long = lesson()
    long["sections"] = [copy.deepcopy(long["sections"][0]) for _ in range(9)]
    assert parse_lesson(long) == "the content has 9 sections; give 3 to 8"
    big = lesson()
    big["sections"][0]["body"] = "b" * 2001
    assert str(parse_lesson(big)).startswith("section 1 body:")
    odd = lesson()
    odd["sections"][0]["kind"] = "story"
    assert str(parse_lesson(odd)).startswith("section 1 kind:")


def test_the_json_schemas_have_no_url_or_image_field_and_state_the_limits() -> None:
    for model in (QuizContent, LessonContent):
        text = json.dumps(model.model_json_schema()).lower()
        for word in ("url", "uri", "image", "href", "src"):
            assert word not in text
    schema = QuizContent.model_json_schema()
    assert schema["properties"]["questions"]["minItems"] == 3
    assert schema["properties"]["questions"]["maxItems"] == 10
    assert schema["$defs"]["QuizQuestion"]["properties"]["options"]["maxItems"] == 6
