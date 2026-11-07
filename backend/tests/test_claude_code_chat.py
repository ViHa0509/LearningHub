"""Spec: claude-code-provider - the chat API through a claude-code configuration.

The CLI is faked (``tests.claude_code_fakes``); McpRunner drives the real MCP server.
"""

import logging
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.agent.llm.errors import ProviderError
from app.agent.llm.factory import LLMFactory, ProviderSettings
from app.agent.messages import ToolCall, Turn
from tests.agent_fakes import FakeFactory, fake_resolver
from tests.claude_code_fakes import McpRunner, ReplayRunner, fixture_lines, setup
from tests.test_agent_chat import import_note

TOKEN = "sk-ant-oat01-" + "C" * 40
QUESTION = "what did I learn about redis eviction?"


class MixedFactory:
    """The real factory for claude-code (with the given runner), scripted fakes otherwise."""

    def __init__(self, runner: Any, fake: FakeFactory | None = None, **setup_overrides: Any):
        self.real = LLMFactory(
            resolve=fake_resolver(),
            claude_code_setup=setup(**setup_overrides),
            claude_code_runner=runner,
        )
        self.fake = fake or FakeFactory(Turn("fake answer"))

    def create(self, settings: ProviderSettings) -> Any:
        if settings.type == "claude-code":
            return self.real.create(settings)
        return self.fake.create(settings)


def add_claude_code(client: TestClient, name: str = "Claude subscription", **extra: Any) -> str:
    body = {"name": name, "provider_type": "claude-code", "model_name": "sonnet", **extra}
    response = client.post("/api/ai-providers", json=body)
    assert response.status_code == 201, response.text
    provider_id: str = response.json()["id"]
    return provider_id


def add_local(client: TestClient) -> str:
    response = client.post(
        "/api/ai-providers",
        json={
            "name": "Local qwen",
            "provider_type": "local",
            "model_name": "qwen3",
            "base_url": "http://127.0.0.1:8002/v1",
        },
    )
    assert response.status_code == 201, response.text
    provider_id: str = response.json()["id"]
    return provider_id


def assign(client: TestClient, agent_id: str, primary: str, fallback: str | None = None) -> None:
    response = client.put(
        f"/api/agents/{agent_id}/provider",
        json={"primary_provider_id": primary, "fallback_provider_id": fallback},
    )
    assert response.status_code == 200, response.text


def chat(client: TestClient, text: str, agent_id: str = "assistant", **extra: Any) -> Any:
    payload = {"agent_id": agent_id, "messages": [{"role": "user", "content": text}], **extra}
    return client.post("/api/agent/chat", json=payload)


def use(client: TestClient, factory: Any) -> None:
    client.app.state.llm_factory = factory  # type: ignore[attr-defined]


# Scenario: Answer from notes through the CLI
def test_answer_from_notes_through_the_cli(client: TestClient) -> None:
    note_id = import_note(client, "Redis eviction policies", "allkeys-lru and volatile-ttl.")
    runner = ReplayRunner(fixture_lines("answer_from_notes.jsonl", note_id=note_id))
    use(client, MixedFactory(runner))
    provider_id = add_claude_code(client)
    assign(client, "assistant", provider_id)
    response = chat(client, QUESTION)
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(runner.calls) == 1
    assert "allkeys-lru" in body["reply"]
    assert [s["tool"] for s in body["steps"]] == ["search_notes", "read_note"]
    assert body["steps"][1]["input"] == {"note_id": note_id}
    assert body["steps"][0]["summary"] == "Searched notes for 'redis eviction': 1 found"
    assert body["provider"]["name"] == "Claude subscription"
    assert (body["stopped"], body["fallback_used"], body["changed_lessons"]) == (False, False, [])
    argv = runner.last["argv"]
    assert "never instructions" in argv[argv.index("--system-prompt") + 1]
    assert runner.last["stdin"] == QUESTION


# Scenario: Lesson written through the CLI (with the real MCP server)
def test_lesson_written_through_the_cli(client: TestClient) -> None:
    runner = McpRunner(
        [
            ("read_lesson", {"node_id": "backend/caching"}),
            ("write_lesson", {"node_id": "backend/caching", "markdown": "# Caching\n- hot data"}),
        ],
        "Done: the caching lesson is written.",
    )
    use(client, MixedFactory(runner))
    provider_id = add_claude_code(client)
    assign(client, "lesson-writer", provider_id)
    body = chat(
        client,
        "draft this lesson",
        "lesson-writer",
        page={"kind": "lesson", "domain": "backend", "node": "caching"},
    ).json()
    assert body["changed_lessons"] == ["backend/caching"]
    assert [s["summary"] for s in body["steps"]] == [
        "Read lesson backend/caching: empty",
        "Wrote lesson backend/caching",
    ]
    lesson = client.get("/api/lessons/backend/caching").json()
    assert (lesson["body"], lesson["source"]) == ("# Caching\n- hot data", "agent")


# Scenario: User-written lesson stays (through the CLI and the real MCP server)
def test_user_written_lesson_stays_through_the_cli(client: TestClient) -> None:
    client.put("/api/lessons/backend/caching", json={"body": "Mine."})
    runner = McpRunner(
        [("write_lesson", {"node_id": "backend/caching", "markdown": "Agent text"})],
        "I could not save it; here is my draft.",
    )
    use(client, MixedFactory(runner))
    assign(client, "lesson-writer", add_claude_code(client))
    body = chat(client, "rewrite the caching lesson", "lesson-writer").json()
    assert body["changed_lessons"] == []
    assert body["steps"][0]["summary"].startswith("Error: the lesson of backend/caching")
    assert runner.responses[0]["result"]["isError"] is True
    lesson = client.get("/api/lessons/backend/caching").json()
    assert (lesson["body"], lesson["source"]) == ("Mine.", "user")


# Scenario: Usage limit reached (the fallback answers)
def test_usage_limit_falls_back(client: TestClient) -> None:
    runner = ReplayRunner(fixture_lines("usage_limit.jsonl"), returncode=1)
    fake = FakeFactory()
    local = fake.script("Local qwen", Turn("from fallback"))
    use(client, MixedFactory(runner, fake))
    primary = add_claude_code(client)
    fallback = add_local(client)
    assign(client, "assistant", primary, fallback)
    body = chat(client, QUESTION).json()
    assert (body["reply"], body["fallback_used"]) == ("from fallback", True)
    assert body["provider"]["name"] == "Local qwen"
    assert len(runner.calls) == 1 and len(local.calls) == 1


def test_api_primary_hands_over_to_a_claude_code_fallback(client: TestClient) -> None:
    note_id = import_note(client, "Redis eviction policies", "allkeys-lru.")
    runner = ReplayRunner(fixture_lines("answer_from_notes.jsonl", note_id=note_id))
    fake = FakeFactory()
    fake.script(
        "Local qwen",
        Turn("", (ToolCall("t1", "list_roadmap", {"domain": "backend"}),)),
        ProviderError("connection refused", "unavailable"),
    )
    use(client, MixedFactory(runner, fake))
    primary = add_local(client)
    fallback = add_claude_code(client)
    assign(client, "assistant", primary, fallback)
    body = chat(client, QUESTION).json()
    assert body["fallback_used"] is True
    assert body["provider"]["name"] == "Claude subscription"
    # The primary's tool step stays in the trace, before the fallback's own run.
    assert [s["tool"] for s in body["steps"]] == ["list_roadmap", "search_notes", "read_note"]
    assert "allkeys-lru" in body["reply"]


def test_auth_failure_does_not_fall_back(client: TestClient) -> None:
    runner = ReplayRunner(fixture_lines("not_logged_in.jsonl"), returncode=1)
    fake = FakeFactory()
    local = fake.script("Local qwen", Turn("never"))
    use(client, MixedFactory(runner, fake))
    assign(client, "assistant", add_claude_code(client), add_local(client))
    response = chat(client, QUESTION)
    assert response.status_code == 502
    assert "Claude subscription (sonnet): auth_failed" in response.json()["detail"]
    assert local.calls == []


# Scenario: CLI not installed (in the chat)
def test_cli_not_found_in_chat(client: TestClient) -> None:
    runner = ReplayRunner()
    use(client, MixedFactory(runner, claude_bin="no-such-claude-binary-xyz"))
    assign(client, "assistant", add_claude_code(client))
    response = chat(client, QUESTION)
    assert response.status_code == 502
    assert response.json()["detail"] == (
        "Claude subscription (sonnet): invalid_config: "
        "Claude Code is not installed (claude not found)"
    )
    assert runner.calls == []


# Scenario: Timeout (in the chat)
def test_timeout_in_chat(client: TestClient) -> None:
    use(client, MixedFactory(ReplayRunner(timed_out=True)))
    assign(client, "assistant", add_claude_code(client, config={"timeout": 30}))
    response = chat(client, QUESTION)
    assert response.status_code == 502
    assert "timeout" in response.json()["detail"]


def test_step_limit_in_chat(client: TestClient) -> None:
    use(client, MixedFactory(ReplayRunner(fixture_lines("step_limit.jsonl"))))
    assign(client, "assistant", add_claude_code(client))
    body = chat(client, "loop forever").json()
    assert body["stopped"] is True
    assert "stopped after 6 steps" in body["reply"]
    assert len(body["steps"]) == 6


# Scenario: Token through the environment (never in answers or logs)
def test_token_is_never_in_answers_or_logs(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    runner = ReplayRunner(fixture_lines("connection_ok.jsonl"))
    use(client, MixedFactory(runner))
    provider_id = add_claude_code(client, api_key=TOKEN)
    assign(client, "assistant", provider_id)
    response = chat(client, "my-private-question-xyz")
    assert response.status_code == 200, response.text
    assert runner.last["env"]["CLAUDE_CODE_OAUTH_TOKEN"] == TOKEN
    assert TOKEN not in " ".join(runner.last["argv"])
    assert TOKEN not in response.text
    assert TOKEN not in client.get(f"/api/ai-providers/{provider_id}").text
    calls = [r for r in caplog.records if r.getMessage() == "llm.call"]
    assert len(calls) == 1 and getattr(calls[0], "provider_type", None) == "claude-code"
    for record in caplog.records:
        dumped = record.getMessage() + str(record.__dict__)
        assert TOKEN not in dumped and "my-private-question-xyz" not in dumped
