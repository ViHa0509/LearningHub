"""Scripted provider for agent tests: no network."""

from collections.abc import Sequence
from typing import Any

from app.agent.messages import Message, ToolSpec, Turn


class FakeProvider:
    """Scripted provider for tests: returns the given turns in order and records each call."""

    def __init__(self, turns: Sequence[Turn | Exception]) -> None:
        self._turns = list(turns)
        self.calls: list[dict[str, Any]] = []

    def complete(
        self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec], model: str
    ) -> Turn:
        self.calls.append(
            {"system": system, "messages": list(messages), "tools": list(tools), "model": model}
        )
        if not self._turns:
            return Turn(text="(script ended)")
        turn = self._turns.pop(0)
        if isinstance(turn, Exception):
            raise turn
        return turn
