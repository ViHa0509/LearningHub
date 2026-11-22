"""App-owned A2UI v0.9 templates for the basic catalog (design 5).

Components are explicit per question (``q1-card``, ``q1-text``, ``q1-image``, ``q1-choice``,
``q1-check``, ``q1-feedback``), so a grading answer can update fixed data paths. No answer and no
explanation is put in these messages: they stay in the answer key on the server.
"""

from typing import Any

from app.a2ui.content import LessonContent, QuizContent, QuizQuestion

VERSION = "v0.9"
CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
CHECK_ACTION = "check_answer"
MAX_QUESTIONS = 10

Message = dict[str, Any]
Component = dict[str, Any]

# The component types of the v0.9 basic catalog (BASIC_COMPONENTS in @a2ui/web_core).
BASIC_COMPONENT_TYPES = frozenset(
    {
        "Text",
        "Image",
        "Icon",
        "Video",
        "AudioPlayer",
        "Row",
        "Column",
        "List",
        "Card",
        "Tabs",
        "Modal",
        "Divider",
        "Button",
        "TextField",
        "CheckBox",
        "ChoicePicker",
        "Slider",
        "DateTimeInput",
    }
)

KIND_LABELS = {"concept": "Concept", "example": "Example", "tip": "Tip", "check": "Check yourself"}


def _create(surface_id: str) -> Message:
    return {"version": VERSION, "createSurface": {"surfaceId": surface_id, "catalogId": CATALOG_ID}}


def _components(surface_id: str, components: list[Component]) -> Message:
    return {
        "version": VERSION,
        "updateComponents": {"surfaceId": surface_id, "components": components},
    }


def _data(surface_id: str, path: str, value: Any) -> Message:
    return {
        "version": VERSION,
        "updateDataModel": {"surfaceId": surface_id, "path": path, "value": value},
    }


def score_text(answered: int, total: int, correct: int) -> str:
    return f"{answered} / {total} answered, {correct} correct"


def _option_list(question: QuizQuestion) -> list[dict[str, str]]:
    """The options as data (label and value); the component binds each label to this list."""
    return [
        {"label": option, "value": str(n)} for n, option in enumerate(question.options, start=1)
    ]


def _bound_options(qid: str, question: QuizQuestion) -> list[dict[str, Any]]:
    """The ChoicePicker options: labels bound to the data model (grading marks the right one),
    values literal."""
    return [
        {"label": {"path": f"/questions/{qid}/options/{i}/label"}, "value": str(i + 1)}
        for i in range(len(question.options))
    ]


def _question_components(
    qid: str, question: QuizQuestion, has_image: bool
) -> tuple[list[Component], list[str]]:
    """The components of one question and the ids to list in its column (in order)."""
    base = f"/questions/{qid}"
    column: list[str] = []
    out: list[Component] = []
    out.append(
        {
            "id": f"{qid}-text",
            "component": "Text",
            "text": {"path": f"{base}/text"},
            "variant": "h4",
        }
    )
    column.append(f"{qid}-text")
    if has_image:
        out.append(
            {
                "id": f"{qid}-image",
                "component": "Image",
                "url": {"path": f"{base}/image"},
                "description": "Picture of the question",
                "fit": "contain",
            }
        )
        column.append(f"{qid}-image")
    out.append(
        {
            "id": f"{qid}-choice",
            "component": "ChoicePicker",
            "variant": "mutuallyExclusive",
            "options": _bound_options(qid, question),
            "value": {"path": f"{base}/choice"},
        }
    )
    out.append({"id": f"{qid}-check-label", "component": "Text", "text": "Check"})
    out.append(
        {
            "id": f"{qid}-check",
            "component": "Button",
            "variant": "primary",
            "child": f"{qid}-check-label",
            "action": {
                "event": {
                    "name": CHECK_ACTION,
                    "context": {"question": qid, "choice": {"path": f"{base}/choice"}},
                }
            },
        }
    )
    out.append(
        {
            "id": f"{qid}-mark",
            "component": "Text",
            "text": {"path": f"{base}/mark"},
            "variant": "h5",
        }
    )
    out.append({"id": f"{qid}-feedback", "component": "Text", "text": {"path": f"{base}/feedback"}})
    column += [f"{qid}-choice", f"{qid}-check", f"{qid}-mark", f"{qid}-feedback"]
    return out, column


def _question_data(question: QuizQuestion, image: str | None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "text": question.text,
        "options": _option_list(question),
        "choice": [],
        "status": "open",
        "mark": "",
        "feedback": "",
    }
    if image:
        data["image"] = image
    return data


def build_quiz(
    surface_id: str, content: QuizContent, images: dict[str, str] | None = None
) -> list[Message]:
    """The messages of a quiz. ``images`` maps a question id (``q1``) to an image address."""
    images = images or {}
    questions = content.questions[:MAX_QUESTIONS]
    components: list[Component] = [
        {"id": "title", "component": "Text", "text": {"path": "/title"}, "variant": "h3"},
        {"id": "score", "component": "Text", "text": {"path": "/score/text"}, "variant": "caption"},
    ]
    root_children = ["title", "score"]
    questions_data: dict[str, Any] = {}
    for number, question in enumerate(questions, start=1):
        qid = f"q{number}"
        image = images.get(qid)
        parts, column = _question_components(qid, question, bool(image))
        components += parts
        components.append({"id": f"{qid}-body", "component": "Column", "children": column})
        components.append({"id": f"{qid}-card", "component": "Card", "child": f"{qid}-body"})
        root_children.append(f"{qid}-card")
        questions_data[qid] = _question_data(question, image)
    components.insert(0, {"id": "root", "component": "Column", "children": root_children})
    data = {
        "title": content.title,
        "score": {"text": score_text(0, len(questions), 0)},
        "questions": questions_data,
    }
    return [
        _create(surface_id),
        _components(surface_id, components),
        _data(surface_id, "/", data),
    ]


def check_questions(content: LessonContent) -> dict[str, QuizQuestion]:
    """The check-yourself questions of a lesson by id (``q1`` for the first one)."""
    found = [s.question for s in content.sections if s.kind == "check" and s.question is not None]
    return {f"q{n}": question for n, question in enumerate(found, start=1)}


def build_lesson(surface_id: str, content: LessonContent) -> list[Message]:
    """The messages of a lesson: one Card per section; a check section embeds a question."""
    components: list[Component] = [
        {"id": "title", "component": "Text", "text": {"path": "/title"}, "variant": "h3"}
    ]
    root_children = ["title"]
    questions_data: dict[str, Any] = {}
    checks = 0
    for number, section in enumerate(content.sections, start=1):
        sid = f"s{number}"
        column = [f"{sid}-kind", f"{sid}-heading"]
        components.append(
            {
                "id": f"{sid}-kind",
                "component": "Text",
                "text": KIND_LABELS[section.kind],
                "variant": "caption",
            }
        )
        components.append(
            {"id": f"{sid}-heading", "component": "Text", "text": section.heading, "variant": "h4"}
        )
        if section.kind == "check" and section.question is not None:
            checks += 1
            qid = f"q{checks}"
            parts, qcolumn = _question_components(qid, section.question, False)
            components += parts
            column += qcolumn
            questions_data[qid] = _question_data(section.question, None)
        else:
            components.append(
                {"id": f"{sid}-body", "component": "Text", "text": section.body or ""}
            )
            column.append(f"{sid}-body")
        components.append({"id": f"{sid}-column", "component": "Column", "children": column})
        components.append({"id": f"{sid}-card", "component": "Card", "child": f"{sid}-column"})
        root_children.append(f"{sid}-card")
    data: dict[str, Any] = {"title": content.title}
    if checks:
        components.append(
            {
                "id": "score",
                "component": "Text",
                "text": {"path": "/score/text"},
                "variant": "caption",
            }
        )
        root_children.append("score")
        data["score"] = {"text": score_text(0, checks, 0)}
        data["questions"] = questions_data
    components.insert(0, {"id": "root", "component": "Column", "children": root_children})
    return [
        _create(surface_id),
        _components(surface_id, components),
        _data(surface_id, "/", data),
    ]


def _key(question: QuizQuestion) -> dict[str, Any]:
    return {
        "answer": question.answer,
        "explanation": question.explanation,
        "options": list(question.options),
    }


def answer_key_for(content: QuizContent | LessonContent) -> dict[str, Any]:
    """The server-side key: question id -> {answer, explanation, options}."""
    if isinstance(content, QuizContent):
        return {f"q{n}": _key(q) for n, q in enumerate(content.questions[:MAX_QUESTIONS], start=1)}
    return {qid: _key(question) for qid, question in check_questions(content).items()}


def feedback_text(correct: bool, option_label: str, explanation: str) -> str:
    if correct:
        return f"Correct. {explanation}"
    return f'Not quite. The answer is "{option_label}". {explanation}'


def grade_messages(
    surface_id: str,
    question_id: str,
    option_label: str,
    correct: bool,
    explanation: str,
    score_text: str,
    option_number: int | None = None,
) -> list[Message]:
    """The updates after a graded answer. ``option_label`` is the correct option's text and
    ``option_number`` its 1-based number: its label then gets a check mark."""
    base = f"/questions/{question_id}"
    out = [
        _data(surface_id, f"{base}/status", "correct" if correct else "wrong"),
        _data(surface_id, f"{base}/mark", "✓ Correct" if correct else "✗ Not quite"),
        _data(surface_id, f"{base}/feedback", feedback_text(correct, option_label, explanation)),
    ]
    if option_number is not None:
        out.append(
            _data(surface_id, f"{base}/options/{option_number - 1}/label", f"{option_label} ✓")
        )
    out.append(_data(surface_id, "/score/text", score_text))
    return out
