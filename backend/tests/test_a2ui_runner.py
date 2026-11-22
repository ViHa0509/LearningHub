"""Spec: a2ui-chat - The Interactive tutor agent, Practice from the question bank, Generated quiz,
Creative lesson, and the claude-code rule of "One request, one count" (the runner, task 2.3)."""

import json
import uuid
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.a2ui.interface import ContentSink, InteractiveRequest
from app.a2ui.runner import ChatInteractiveRunner
from app.agent.llm.errors import ProviderError
from app.agent.loop import Page, tool_loop
from app.agent.messages import ToolCall, Turn
from app.agent.resolve import ResolveError
from app.agent.tools import AgentTools
from app.db import A2uiSurface, User
from tests.agent_fakes import FakeModel
from tests.test_question_banks import SLUG, driving, make_bank

QUIZ = {
    "title": "Docker networking",
    "questions": [
        {
            "text": f"Question {n}?",
            "options": ["bridge", "host", "none"],
            "answer": 1,
            "explanation": f"Because {n}.",
        }
        for n in range(1, 4)
    ],
}
LESSON = {
    "title": "Docker volumes",
    "sections": [
        {"kind": "concept", "heading": "What", "body": "A volume keeps data."},
        {"kind": "concept", "heading": "Why", "body": "Containers are disposable."},
        {"kind": "example", "heading": "Try", "body": "`docker volume create data`"},
        {
            "kind": "check",
            "heading": "Check",
            "question": {
                "text": "Where does a volume live?",
                "options": ["In the image", "Outside the container"],
                "answer": 2,
                "explanation": "Docker manages it outside the container.",
            },
        },
    ],
}


def call(name: str, **args: Any) -> ToolCall:
    return ToolCall(id=f"id-{name}", name=name, input=args)


class StubModel:
    """Stands in for the `a2ui` agent's AgentModel: runs the app's tool loop on a FakeModel."""

    def __init__(
        self,
        *turns: Turn | Exception,
        provider_type: str = "anthropic",
        fail: Exception | None = None,
    ) -> None:
        self.primary = SimpleNamespace(row=SimpleNamespace(provider_type=provider_type))
        self.fallback: Any = None
        self.counted = False
        self.fake = FakeModel(turns)
        self.fail = fail
        self.runs = 0

    def count_as_part_of_request(self) -> None:
        self.counted = True

    def run(self, system: str, conversation: Any, tools: AgentTools, max_steps: int) -> Any:
        self.runs += 1
        if self.fail is not None:
            raise self.fail
        return tool_loop(self.fake, system, conversation, tools, max_steps)


@pytest.fixture
def db(client: TestClient) -> Iterator[Session]:
    with client.app.state.session_factory() as s:  # type: ignore[attr-defined]
        yield s


def admin(db: Session) -> User:
    user: User = db.scalars(select(User).where(User.role == "admin")).one()
    return user


def runner(
    client: TestClient,
    db: Session,
    model: Any,
    area: str | None = None,
    page: Page | None = None,
) -> ChatInteractiveRunner:
    app: FastAPI = client.app  # type: ignore[assignment]
    user = admin(db)

    def tools_for(sink: ContentSink) -> AgentTools:
        return AgentTools(
            db, app.state.catalog, user_id=user.id, agent_id="a2ui", content_sink=sink
        )

    def resolve() -> Any:
        if isinstance(model, Exception):
            raise model
        return model

    return ChatInteractiveRunner(
        db, user, app.state.catalog, page or Page(), area, resolve, tools_for
    )


def no_answers(value: Any) -> bool:
    text = json.dumps(value)
    return "Because" not in text and '"answer"' not in text and "explanation" not in text


# Scenario: Quiz me (the runner side)
def test_quiz_is_made_stored_and_returned_without_answers(client: TestClient, db: Session) -> None:
    model = StubModel(Turn(text="", tool_calls=(call("make_quiz", **QUIZ),)), Turn(text="Done."))
    result = runner(client, db, model)(InteractiveRequest(kind="quiz", topic="docker networking"))
    assert result.error is None and result.surface is not None
    assert model.counted is True
    assert result.model_result == {
        "surface": {"kind": "quiz", "title": "Docker networking", "questions": 3}
    }
    assert result.summary == "Made an interactive quiz: Docker networking (3 questions)"
    assert no_answers(result.surface) and no_answers(result.model_result)
    db.commit()
    row = db.get(A2uiSurface, uuid.UUID(result.surface["id"]))
    assert row is not None and row.kind == "quiz" and row.message_id is None
    assert (
        row.answer_key["q1"]["answer"] == 1 and row.answer_key["q1"]["explanation"] == "Because 1."
    )
    create = result.surface["messages"][0]["createSurface"]
    assert create["surfaceId"] == f"a2ui-{row.id}"
    # The agent was offered only the read tools and the quiz tool.
    offered = {spec.name for spec in model.fake.calls[0]["tools"]}
    assert offered == {"search_notes", "read_note", "read_lesson", "list_roadmap", "make_quiz"}


# Scenario: Area with a bank
def test_practice_with_a_bank_calls_no_model(client: TestClient, db: Session) -> None:
    driving(client)
    make_bank(client)
    model = StubModel()
    result = runner(
        client, db, model, area=SLUG, page=Page(kind="lesson", domain=SLUG, node="chuong-1")
    )(InteractiveRequest(kind="practice", topic="chuong 1", count=4))
    assert model.runs == 0 and result.surface is not None
    assert result.surface["kind"] == "practice" and result.model_result["surface"]["questions"] == 4
    assert no_answers(result.surface["messages"])
    db.flush()
    row = db.get(A2uiSurface, uuid.UUID(result.surface["id"]))
    assert row is not None and all(k.get("bank_question_id") for k in row.answer_key.values())


# Scenario: Area without a bank
def test_practice_without_a_bank_generates(client: TestClient, db: Session) -> None:
    model = StubModel(Turn(text="", tool_calls=(call("make_quiz", **QUIZ),)), Turn(text="Done."))
    result = runner(client, db, model, area="backend")(
        InteractiveRequest(kind="practice", topic="redis")
    )
    assert model.runs == 1 and result.surface is not None and result.surface["kind"] == "practice"


# Scenario: Lesson with a check
def test_lesson_with_a_check_section(client: TestClient, db: Session) -> None:
    model = StubModel(
        Turn(text="", tool_calls=(call("make_lesson", **LESSON),)), Turn(text="Done.")
    )
    result = runner(client, db, model)(InteractiveRequest(kind="lesson", topic="docker volumes"))
    assert result.surface is not None and result.surface["kind"] == "lesson"
    assert result.model_result["surface"]["questions"] == 1
    assert result.summary == "Made an interactive lesson: Docker volumes (1 question)"
    offered = {spec.name for spec in model.fake.calls[0]["tools"]}
    assert "make_lesson" in offered and "make_quiz" not in offered


# Scenario: Invalid quiz content (then fixed within the steps)
def test_invalid_content_is_refused_and_can_be_fixed(client: TestClient, db: Session) -> None:
    bad = {**QUIZ, "questions": [{**QUIZ["questions"][0], "options": ["only one"]}] * 3}
    model = StubModel(
        Turn(text="", tool_calls=(call("make_quiz", **bad),)),
        Turn(text="", tool_calls=(call("make_quiz", **QUIZ),)),
        Turn(text="Done."),
    )
    result = runner(client, db, model)(InteractiveRequest(kind="quiz", topic="docker"))
    assert result.surface is not None
    refused = model.fake.calls[1]["messages"][-1].text
    assert "error" in refused and "option" in refused


# Scenario: The agent fails
def test_provider_failure_makes_no_surface(client: TestClient, db: Session) -> None:
    model = StubModel(fail=ProviderError("down", "unavailable"))
    result = runner(client, db, model)(InteractiveRequest(kind="quiz", topic="docker"))
    assert result.surface is None and result.error is not None and "unavailable" in result.error
    assert "error" in result.model_result
    assert db.scalars(select(A2uiSurface)).all() == []


def test_steps_running_out_make_no_surface(client: TestClient, db: Session) -> None:
    looping = [Turn(text="", tool_calls=(call("search_notes", query=f"x{n}"),)) for n in range(10)]
    model = StubModel(*looping)
    result = runner(client, db, model)(InteractiveRequest(kind="quiz", topic="docker"))
    assert (
        result.surface is None
        and result.error == "the Interactive tutor did not produce valid content"
    )


# Scenario: Text instead of content
def test_text_only_end_makes_no_surface(client: TestClient, db: Session) -> None:
    model = StubModel(Turn(text="Here is a quiz: 1) What is Docker?"))
    result = runner(client, db, model)(InteractiveRequest(kind="quiz", topic="docker"))
    assert result.surface is None
    assert result.model_result == {"error": "the Interactive tutor did not produce valid content"}


def test_claude_code_provider_is_refused_before_running(client: TestClient, db: Session) -> None:
    model = StubModel(provider_type="claude-code")
    result = runner(client, db, model)(InteractiveRequest(kind="quiz", topic="docker"))
    assert model.runs == 0 and result.surface is None
    assert result.error is not None and "Claude Code" in result.error


def test_no_usable_provider_is_an_error(client: TestClient, db: Session) -> None:
    result = runner(client, db, ResolveError(409, "no provider"))(
        InteractiveRequest(kind="quiz", topic="docker")
    )
    assert result.surface is None and result.error is not None and "no provider" in result.error


def test_made_rows_are_stored_again_after_a_conflict_rollback(
    client: TestClient, db: Session
) -> None:
    """store_turn rolls back and retries after a write conflict; the surfaces made before must
    be stored with the retried turn, or the answer would point at rows that do not exist."""
    from app.agent.history import NewMessage, store_turn
    from app.routes.agent import link_surfaces

    model = StubModel(Turn(text="", tool_calls=(call("make_quiz", **QUIZ),)), Turn(text="Done."))
    made_by = runner(client, db, model)
    result = made_by(InteractiveRequest(kind="quiz", topic="docker"))
    assert result.surface is not None and len(made_by.made) == 1
    db.rollback()  # what store_turn does after an IntegrityError
    assert db.scalars(select(A2uiSurface)).all() == []
    _, rows = store_turn(
        db,
        admin(db).id,
        None,
        [NewMessage(role="user", content="quiz me"), NewMessage(role="assistant", content="Here.")],
        before_commit=lambda s, new: link_surfaces(s, made_by.made, new[-1].id),
    )
    stored = db.scalars(select(A2uiSurface)).all()
    assert [str(r.id) for r in stored] == [result.surface["id"]]
    assert stored[0].message_id == rows[-1].id
