"""Scripted models, factories, SDK stubs and resolvers for agent tests: no network."""

import socket
from collections.abc import Sequence
from types import SimpleNamespace
from typing import Any

import httpx2

from app.agent.llm.factory import ProviderSettings
from app.agent.messages import Message, ToolSpec, Turn


class FakeModel:
    """Returns the given turns in order and records each call."""

    def __init__(self, turns: Sequence[Turn | Exception], model: str = "fake-model") -> None:
        self._turns = list(turns)
        self.model = model
        self.calls: list[dict[str, Any]] = []
        self.models: list[str] | Exception = ["m-1", "m-2"]

    def complete(self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec]) -> Turn:
        self.calls.append({"system": system, "messages": list(messages), "tools": list(tools)})
        if not self._turns:
            return Turn(text="(script ended)")
        turn = self._turns.pop(0)
        if isinstance(turn, Exception):
            raise turn
        return turn

    def list_models(self) -> list[str]:
        if isinstance(self.models, Exception):
            raise self.models
        return list(self.models)


class FakeFactory:
    """Builds scripted models: one per provider name (``by_name``) or a shared default."""

    def __init__(self, *turns: Turn | Exception) -> None:
        self.default = FakeModel(turns)
        self.by_name: dict[str, FakeModel] = {}
        self.built: list[ProviderSettings] = []

    def script(self, name: str, *turns: Turn | Exception) -> FakeModel:
        self.by_name[name] = FakeModel(turns)
        return self.by_name[name]

    def create(self, settings: ProviderSettings) -> FakeModel:
        self.built.append(settings)
        model = self.by_name.get(settings.name, self.default)
        model.model = settings.model
        return model


class NoNetworkFactory:
    """The default factory in API tests: any attempt to build a real client fails the test."""

    def create(self, settings: ProviderSettings) -> Any:
        raise AssertionError(f"a test tried to build a real client for {settings.name}")


def fake_resolver(table: dict[str, str] | None = None) -> Any:
    """getaddrinfo stand-in: hosts in ``table`` map to that address, others to a public one."""
    table = table or {}

    def resolve(host: str, port: int, *_: Any) -> list[tuple[Any, ...]]:
        if host == "unresolvable.invalid":
            raise socket.gaierror("name not known")
        address = table.get(host, "93.184.216.34")
        family = socket.AF_INET6 if ":" in address else socket.AF_INET
        return [(family, socket.SOCK_STREAM, 6, "", (address, port))]

    return resolve


# --- SDK stubs ---------------------------------------------------------------------


class Recorder:
    """Stands in for an SDK method: records kwargs, returns or raises a canned value."""

    def __init__(self, result: Any) -> None:
        self.result = result
        self.kwargs: dict[str, Any] = {}

    def __call__(self, **kwargs: Any) -> Any:
        self.kwargs = kwargs
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def anthropic_client(result: Any) -> tuple[Any, Recorder]:
    create = Recorder(result)
    return SimpleNamespace(messages=SimpleNamespace(create=create)), create


def openai_client(result: Any) -> tuple[Any, Recorder]:
    create = Recorder(result)
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))), create


def openai_answer(text: str) -> Any:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=text, tool_calls=None))]
    )


def anthropic_answer(text: str) -> Any:
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)])


REQUEST = httpx2.Request("POST", "https://provider.test/v1/chat")


def status_error(sdk: Any, name: str, status: int, message: str = "refused") -> Exception:
    response = httpx2.Response(status, request=REQUEST)
    error: Exception = getattr(sdk, name)(message, response=response, body=None)
    return error


def timeout_error(sdk: Any) -> Exception:
    error: Exception = sdk.APITimeoutError(request=REQUEST)
    return error


def connection_error(sdk: Any) -> Exception:
    error: Exception = sdk.APIConnectionError(request=REQUEST)
    return error
