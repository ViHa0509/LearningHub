"""The contract between the agent tools and the interactive runner (change a2ui-chat-agent).

`show_interactive` (an assistant tool) calls an `InteractiveRunner`; the runner draws from a
question bank or runs the `a2ui` agent, whose content tools (`make_quiz`, `make_lesson`) put the
validated content into a `ContentSink`. Keeping these types here lets tools.py and runner.py
depend on the contract, not on each other.
"""

from dataclasses import dataclass
from typing import Any, Literal, Protocol

from app.a2ui.content import LessonContent, QuizContent

Kind = Literal["quiz", "practice", "lesson"]
ContentKind = Literal["quiz", "lesson"]


@dataclass(frozen=True)
class InteractiveRequest:
    kind: Kind
    topic: str
    node_id: str | None = None
    count: int | None = None


@dataclass(frozen=True)
class InteractiveResult:
    """What one `show_interactive` call produced.

    ``surface`` is the chat answer's surface ({id, kind, title, messages}) or None when nothing
    was made; ``model_result`` is the JSON given back to the assistant model (never an answer);
    ``summary`` is the one-line trace; ``error`` says why nothing was made.
    """

    surface: dict[str, Any] | None
    model_result: dict[str, Any]
    summary: str
    error: str | None = None


class InteractiveRunner(Protocol):
    def __call__(self, request: InteractiveRequest) -> InteractiveResult: ...


class ContentSink:
    """Where the `a2ui` agent's content tool leaves the content it validated; the last valid call
    wins. The runner reads it after the agent's run."""

    def __init__(self, kind: ContentKind) -> None:
        self.kind: ContentKind = kind
        self.content: QuizContent | LessonContent | None = None
