"""Provider-neutral conversation types used by the agent loop and every adapter."""

from dataclasses import dataclass, field
from typing import Any, Literal

from app.agent.llm.errors import ProviderError


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
    # The provider's own content blocks of an assistant turn (Anthropic web search results),
    # sent back as they were; an adapter that does not know them ignores them.
    raw: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class Turn:
    """What the model answered: text, tool calls, or both."""

    text: str
    tool_calls: tuple[ToolCall, ...] = field(default_factory=tuple)
    # Web searches the provider ran itself while answering, and the pages it found.
    searches: tuple[str, ...] = ()
    sources: tuple[tuple[str, str], ...] = ()  # (title, url)
    raw: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]


__all__ = ["Message", "ProviderError", "ToolCall", "ToolSpec", "Turn"]
