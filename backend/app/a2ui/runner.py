"""The interactive runner behind the assistant's `show_interactive` tool (change a2ui-chat-agent).

Practice in an area with a question bank draws from the bank with no model call. Anything else
runs the `a2ui` agent ("Interactive tutor") on its own provider chain: it reads the user's notes
and fills one content tool, which leaves validated content in a `ContentSink`. The server then
builds the A2UI messages from templates, stores the surface with its answer key (owned by the
user, linked to the chat message later in the same commit) and returns the surface without any
answer. The agent never writes layout.
"""

import uuid
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.a2ui.bank import draw_bank_questions
from app.a2ui.content import LessonContent, QuizContent
from app.a2ui.interface import (
    ContentKind,
    ContentSink,
    InteractiveRequest,
    InteractiveResult,
)
from app.a2ui.templates import answer_key_for, build_lesson, build_quiz
from app.agent.agents import AGENTS
from app.agent.llm.errors import ProviderError
from app.agent.loop import Page, system_prompt
from app.agent.messages import Message
from app.agent.resolve import AgentModel, ResolveError
from app.agent.tools import AgentTools
from app.db import A2uiSurface, User
from app.roadmaps import RoadmapCatalog

A2UI_AGENT = "a2ui"
MAX_STEPS = 6
CLAUDE_CODE = "claude-code"


def _failed(error: str) -> InteractiveResult:
    return InteractiveResult(
        surface=None,
        model_result={"error": error},
        summary=f"No interactive content: {error}",
        error=error,
    )


def _node_slug(request: InteractiveRequest, page: Page) -> str | None:
    if request.node_id and "/" in request.node_id:
        return request.node_id.split("/", 1)[1]
    return page.node if page.kind == "lesson" else None


def _task_text(request: InteractiveRequest) -> str:
    if request.kind == "lesson":
        return (
            f"Make an interactive lesson about: {request.topic}. Use 3 to 8 sections and at "
            "least one check-yourself question. Call make_lesson once with the whole lesson."
        )
    count = request.count or 5
    return (
        f"Make a quiz of {count} questions about: {request.topic}. Base it on the user's notes "
        "and lesson where they exist. Call make_quiz once with the whole quiz."
    )


def _question_count(content: QuizContent | LessonContent) -> int:
    if isinstance(content, QuizContent):
        return len(content.questions)
    return sum(1 for section in content.sections if section.kind == "check")


class ChatInteractiveRunner:
    """One per chat request. ``resolve_model`` builds the `a2ui` agent's provider chain;
    ``tools_for`` builds that agent's tools around a content sink."""

    def __init__(
        self,
        session: Session,
        user: User,
        catalog: RoadmapCatalog,
        page: Page,
        area_slug: str | None,
        resolve_model: Callable[[], AgentModel],
        tools_for: Callable[[ContentSink], AgentTools],
        max_steps: int = MAX_STEPS,
    ) -> None:
        self._session = session
        self._user = user
        self._catalog = catalog
        self._page = page
        self._area_slug = area_slug
        self._resolve_model = resolve_model
        self._tools_for = tools_for
        self._max_steps = max_steps
        # The surface rows made in this request; the chat route links them to its message.
        self.made: list[A2uiSurface] = []

    def __call__(self, request: InteractiveRequest) -> InteractiveResult:
        if request.kind == "practice" and self._area_slug is not None:
            draw = draw_bank_questions(
                self._session,
                self._user,
                self._area_slug,
                _node_slug(request, self._page),
                request.count,
            )
            if draw is not None:
                key = answer_key_for(draw.content)
                for question_id, bank_id in draw.bank_ids.items():
                    if question_id in key:
                        key[question_id]["bank_question_id"] = str(bank_id)
                return self._store("practice", draw.content, key, draw.images)
        kind: ContentKind = "lesson" if request.kind == "lesson" else "quiz"
        made = self._generate(kind, request)
        if isinstance(made, str):
            return _failed(made)
        return self._store(request.kind, made, answer_key_for(made), None)

    def _generate(
        self, kind: ContentKind, request: InteractiveRequest
    ) -> QuizContent | LessonContent | str:
        try:
            model = self._resolve_model()
        except ResolveError as exc:
            return f"the Interactive tutor has no usable provider ({exc.detail})"
        rows = [model.primary.row] + ([model.fallback.row] if model.fallback else [])
        if any(row.provider_type == CLAUDE_CODE for row in rows):
            return (
                "the Interactive tutor's provider is of type Claude Code, which is not "
                "supported for interactive content; choose another provider in Settings > Agents"
            )
        model.count_as_part_of_request()
        sink = ContentSink(kind)
        agent = AGENTS[A2UI_AGENT]
        system = system_prompt(self._page, self._catalog, agent.instructions)
        conversation = [Message(role="user", text=_task_text(request))]
        tools = self._tools_for(sink)
        try:
            model.run(system, conversation, tools, self._max_steps)
        except ProviderError as exc:
            return f"the Interactive tutor's provider failed ({exc.category})"
        if tools.should_stop():
            return "the user stopped the answer"
        if sink.content is None:
            return "the Interactive tutor did not produce valid content"
        return sink.content

    def _store(
        self,
        kind: str,
        content: QuizContent | LessonContent,
        key: dict[str, Any],
        images: dict[str, str] | None,
    ) -> InteractiveResult:
        surface_uuid = uuid.uuid4()
        surface_id = f"a2ui-{surface_uuid}"
        if isinstance(content, QuizContent):
            messages = build_quiz(surface_id, content, images)
        else:
            messages = build_lesson(surface_id, content)
        row = A2uiSurface(
            id=surface_uuid,
            user_id=self._user.id,
            kind=kind,
            title=content.title,
            messages=messages,
            answer_key=key,
            answers={},
        )
        self._session.add(row)
        self._session.flush()
        self.made.append(row)
        count = _question_count(content)
        noun = "question" if count == 1 else "questions"
        label = "lesson" if kind == "lesson" else kind
        return InteractiveResult(
            surface={
                "id": str(surface_uuid),
                "kind": kind,
                "title": content.title,
                "messages": messages,
            },
            model_result={"surface": {"kind": kind, "title": content.title, "questions": count}},
            summary=f"Made an interactive {label}: {content.title} ({count} {noun})",
        )
