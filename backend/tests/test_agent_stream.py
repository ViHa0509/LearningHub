"""Spec: agent-chat (change agent-streaming) - streamed answers: the adapters' streaming and the
NDJSON route."""

import json
import uuid
from types import SimpleNamespace
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agent.llm.adapters import AnthropicChat, OpenAICompatibleChat
from app.agent.llm.errors import ProviderError
from app.agent.messages import Message, Turn
from app.agent.ratelimit import RateLimiter
from app.db import AgentRun, ChatMessage
from tests.agent_fakes import anthropic_answer
from tests.test_agent_chat import call, use

USER = [Message(role="user", text="hi")]
STREAM = {"Accept": "application/x-ndjson"}

# --- 1.1 adapters ---------------------------------------------------------------------------


class AnthropicStream:
    def __init__(self, parts: list[str], final: Any) -> None:
        self.text_stream = iter(parts)
        self._final = final

    def __enter__(self) -> "AnthropicStream":
        return self

    def __exit__(self, *exc: Any) -> None:
        return None

    def get_final_message(self) -> Any:
        return self._final


def test_anthropic_streams_text_and_returns_the_same_turn() -> None:
    sent: list[dict[str, Any]] = []

    def stream(**kwargs: Any) -> AnthropicStream:
        sent.append(kwargs)
        return AnthropicStream(["Hel", "lo"], anthropic_answer("Hello"))

    client = SimpleNamespace(messages=SimpleNamespace(stream=stream))
    parts: list[str] = []
    turn = AnthropicChat(client, "claude-x", {}).complete("sys", USER, [], on_text=parts.append)
    assert parts == ["Hel", "lo"]
    assert turn == Turn(text="Hello")
    assert sent[0]["model"] == "claude-x"


def chunk(content: str | None = None, tool: Any = None, finish: str | None = None) -> Any:
    delta = SimpleNamespace(content=content, tool_calls=[tool] if tool else None)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta, finish_reason=finish)])


def tool_part(index: int, id: str | None, name: str | None, args: str) -> Any:
    return SimpleNamespace(index=index, id=id, function=SimpleNamespace(name=name, arguments=args))


def test_openai_stream_joins_text_and_tool_call_parts() -> None:
    sent: list[dict[str, Any]] = []
    chunks = [
        chunk("Let "),
        chunk("me look."),
        chunk(tool=tool_part(0, "c1", "search_notes", '{"que')),
        chunk(tool=tool_part(0, None, None, 'ry": "redis"}')),
        SimpleNamespace(choices=[]),
        chunk(finish="tool_calls"),
    ]

    def create(**kwargs: Any) -> Any:
        sent.append(kwargs)
        return iter(chunks)

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    parts: list[str] = []
    turn = OpenAICompatibleChat(client, "gpt-x", {}).complete("sys", USER, [], on_text=parts.append)
    assert sent[0]["stream"] is True
    assert parts == ["Let ", "me look."]
    assert turn.text == "Let me look."
    assert [(c.id, c.name, c.input) for c in turn.tool_calls] == [
        ("c1", "search_notes", {"query": "redis"})
    ]
    assert turn.truncated is False


def test_openai_stream_cut_by_the_output_limit() -> None:
    def create(**kwargs: Any) -> Any:
        return iter([chunk("par"), chunk("t", finish="length")])

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    chat = OpenAICompatibleChat(client, "gpt-x", {})
    turn = chat.complete("sys", USER, [], on_text=lambda _: None)
    assert turn.text == "part"
    assert turn.truncated is True


# --- 1.2 the route --------------------------------------------------------------------------


def stream(client: TestClient, run_id: uuid.UUID | None = None, **extra: Any) -> Any:
    body: dict[str, Any] = {"messages": [{"role": "user", "content": "what is redis?"}], **extra}
    if run_id is not None:
        body["run_id"] = str(run_id)
    return client.post("/api/agent/chat", json=body, headers=STREAM)


def events(response: Any) -> list[dict[str, Any]]:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/x-ndjson")
    return [json.loads(line) for line in response.text.splitlines() if line]


def stored(client: TestClient) -> list[ChatMessage]:
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        return list(db.scalars(select(ChatMessage).order_by(ChatMessage.position)))


def test_stream_sends_text_steps_then_the_answer(client: TestClient) -> None:
    use(
        client,
        Turn(text="Let me look", tool_calls=(call("search_notes", query="redis"),)),
        Turn(text="Redis is a cache."),
    )
    lines = events(stream(client))
    kinds = [e["type"] for e in lines]
    # Text before the tool call, then the step, then the answer text, then done.
    assert kinds.index("step") < len(kinds) - 1
    assert kinds[-1] == "done"
    step = next(e for e in lines if e["type"] == "step")["step"]
    assert step["tool"] == "search_notes" and step["input"] == {"query": "redis"}
    after_step = lines[kinds.index("step") + 1 : -1]
    assert "".join(e["text"] for e in after_step).strip() == "Redis is a cache."
    answer = lines[-1]["answer"]
    assert answer["reply"] == "Redis is a cache."
    assert [s["tool"] for s in answer["steps"]] == ["search_notes"]
    # The same turn is stored as with /chat.
    rows = stored(client)
    assert [r.role for r in rows] == ["user", "assistant"]
    assert rows[-1].content == "Redis is a cache."
    assert str(rows[-1].id) == answer["assistant_message_id"]


def test_stream_answer_has_the_shape_of_chat(client: TestClient) -> None:
    use(client, Turn(text="one"), Turn(text="two"))
    plain = client.post(
        "/api/agent/chat", json={"messages": [{"role": "user", "content": "q"}]}
    ).json()
    streamed = events(stream(client))[-1]["answer"]
    assert set(streamed) == set(plain)


def test_provider_error_ends_the_stream_and_stores_nothing(client: TestClient) -> None:
    use(client, ProviderError("down", "unavailable"))
    run = uuid.uuid4()
    lines = events(stream(client, run))
    assert lines[-1]["type"] == "error"
    assert lines[-1]["status"] == 502
    assert stored(client) == []
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        assert list(db.scalars(select(AgentRun))) == []


def test_checks_answer_http_errors_before_the_stream(client: TestClient) -> None:
    use(client, Turn(text="ok"))
    assert stream(client, agent_id="nobody").status_code == 404
    missing = stream(client, session_id=str(uuid.uuid4()))
    assert missing.status_code == 404
    assert missing.json() == {"detail": "chat session not found"}
    client.app.state.rate_limiter = RateLimiter(1)  # type: ignore[attr-defined]
    assert stream(client).status_code == 200
    limited = stream(client)
    assert limited.status_code == 429
    assert limited.json()["detail"].startswith("Too many agent requests")


def test_stream_route_needs_the_app_header(client: TestClient) -> None:
    body = {"messages": [{"role": "user", "content": "q"}]}
    response = client.post("/api/agent/chat", json=body, headers={**STREAM, "X-LearningHub": ""})
    assert response.status_code == 403
