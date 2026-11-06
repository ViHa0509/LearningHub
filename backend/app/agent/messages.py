"""Provider-neutral conversation types used by the agent loop and every adapter."""

from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    input: dict[str, Any]


@dataclass(frozen=True)
class Message:
    """One conversation entry: user text, assistant text with tool calls, or a tool result."""

    role: Literal["user", "assistant", "tool"]
    text: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    tool_call_id: str | None = None


@dataclass(frozen=True)
class Turn:
    """What the model answered: text, tool calls, or both."""

    text: str
    tool_calls: tuple[ToolCall, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]


class ProviderError(Exception):
    """The provider failed (bad key, rate limit, network); the message is safe to show."""
