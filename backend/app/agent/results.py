"""What one agent request produced: the reply, the tool trace and the changed lessons."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Step:
    tool: str
    input: dict[str, Any]
    summary: str


@dataclass
class AgentResult:
    reply: str
    steps: list[Step] = field(default_factory=list)
    changed_lessons: list[str] = field(default_factory=list)
    # Ids of notes the assistant saved in this request: the app refreshes the notes list.
    changed_notes: list[str] = field(default_factory=list)
    stopped: bool = False
    # A topic proposal of the outline agent (not saved): {"area": ..., "topics": [...]}.
    proposed_topics: dict[str, Any] | None = None


def stopped_reply(max_steps: int) -> str:
    return (
        f"I stopped after {max_steps} steps without a final answer. "
        "The tools I used are listed below; ask again more narrowly."
    )
