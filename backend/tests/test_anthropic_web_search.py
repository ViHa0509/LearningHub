"""Spec: agent-providers - Internet search per agent, with an Anthropic provider (Anthropic's own
web search tool, a server tool). No network: the SDK client is a scripted double."""

from types import SimpleNamespace as NS
from typing import Any

from app.agent.llm.adapters import AnthropicChat, from_anthropic, web_search_tool
from app.agent.loop import tool_loop, with_sources
from app.agent.messages import Message, ToolSpec


class Script:
    """messages.create that answers the scripted responses in order and records every request."""

    def __init__(self, *responses: Any) -> None:
        self.responses = list(responses)
        self.requests: list[dict[str, Any]] = []

    def __call__(self, **kwargs: Any) -> Any:
        self.requests.append(kwargs)
        return self.responses.pop(0)


def client(script: Script) -> Any:
    return NS(messages=NS(create=script))


def search_response(
    query: str, *results: tuple[str, str], text: str = "", stop: str = "end_turn"
) -> Any:
    content: list[Any] = [
        NS(type="server_tool_use", id="srv_1", name="web_search", input={"query": query}),
        NS(
            type="web_search_tool_result",
            tool_use_id="srv_1",
            content=[
                NS(type="web_search_result", title=t, url=u, encrypted_content="e")
                for t, u in results
            ],
        ),
    ]
    if text:
        content.append(NS(type="text", text=text))
    return NS(content=content, stop_reason=stop)


SPEC = ToolSpec(name="search_notes", description="Search notes", parameters={"type": "object"})


def test_the_web_search_tool_is_sent_only_when_asked_with_the_version_of_the_model() -> None:
    script = Script(
        NS(content=[NS(type="text", text="hi")], stop_reason="end_turn"),
        NS(content=[NS(type="text", text="hi")], stop_reason="end_turn"),
    )
    chat = AnthropicChat(client(script), "claude-opus-5-5", {})
    chat.complete("sys", [Message(role="user", text="q")], [SPEC])
    assert [t.get("name") for t in script.requests[0]["tools"]] == ["search_notes"]
    chat.complete("sys", [Message(role="user", text="q")], [SPEC], web_search=True)
    assert script.requests[1]["tools"][-1] == {
        "type": "web_search_20260209",
        "name": "web_search",
        "max_uses": 5,
    }
    assert web_search_tool("claude-haiku-4-5")["type"] == "web_search_20250305"


def test_searches_and_sources_are_read_from_the_server_blocks() -> None:
    turn = from_anthropic(
        search_response("jwt expiry", ("JWT RFC", "https://example.test/rfc"), text="Through exp.")
    )
    assert turn.text == "Through exp."
    assert turn.searches == ("jwt expiry",)
    assert turn.sources == (("JWT RFC", "https://example.test/rfc"),)
    assert [b["type"] for b in turn.raw] == ["server_tool_use", "web_search_tool_result", "text"]


def test_a_search_error_does_not_raise_and_lists_no_source() -> None:
    response = NS(
        content=[
            NS(type="server_tool_use", id="srv_1", name="web_search", input={"query": "x"}),
            NS(
                type="web_search_tool_result",
                tool_use_id="srv_1",
                content=NS(type="web_search_tool_result_error", error_code="max_uses_exceeded"),
            ),
            NS(type="text", text="I could not search."),
        ],
        stop_reason="end_turn",
    )
    turn = from_anthropic(response)
    assert turn.sources == () and turn.searches == ("x",)


def test_a_paused_turn_goes_on_from_its_content() -> None:
    script = Script(
        search_response("first", ("A", "https://a.test"), stop="pause_turn"),
        search_response("second", ("B", "https://b.test"), text="Done."),
    )
    turn = AnthropicChat(client(script), "claude-opus-5-5", {}).complete(
        "sys", [Message(role="user", text="q")], [], web_search=True
    )
    assert turn.text == "Done."
    assert turn.searches == ("first", "second")
    assert [u for _, u in turn.sources] == ["https://a.test", "https://b.test"]
    resumed = script.requests[1]["messages"]
    assert resumed[-1]["role"] == "assistant"
    assert resumed[-1]["content"][0]["type"] == "server_tool_use"


class NoTools:
    """AgentTools stand-in: one tool that answers a fixed result."""

    @staticmethod
    def specs() -> tuple[ToolSpec, ...]:
        return (SPEC,)

    def run(self, name: str, args: dict[str, Any]) -> Any:
        return NS(result='{"notes": []}', summary="Searched notes", changed_lesson=None)


def test_the_tool_loop_shows_searches_lists_sources_and_sends_the_server_blocks_back() -> None:
    with_tool = search_response("redis eviction", ("Redis docs", "https://redis.test/eviction"))
    with_tool.content.append(
        NS(type="tool_use", id="tu_1", name="search_notes", input={"query": "redis"})
    )
    with_tool.stop_reason = "tool_use"
    script = Script(
        with_tool, NS(content=[NS(type="text", text="Use allkeys-lru.")], stop_reason="end_turn")
    )
    chat = AnthropicChat(client(script), "claude-opus-5-5", {})
    result = tool_loop(chat, "sys", [Message(role="user", text="q")], NoTools(), 4, web_search=True)  # type: ignore[arg-type]
    assert [s.summary for s in result.steps] == [
        "Searched the web for 'redis eviction'",
        "Searched notes",
    ]
    assert (
        result.reply == "Use allkeys-lru.\n\nSources:\n- [Redis docs](https://redis.test/eviction)"
    )
    # The second request carries the first answer's blocks as they came, then the tool result.
    second = script.requests[1]["messages"]
    assert [b["type"] for b in second[1]["content"]] == [
        "server_tool_use",
        "web_search_tool_result",
        "tool_use",
    ]
    assert second[2]["content"][0]["type"] == "tool_result"


def test_without_the_switch_the_loop_sends_no_search_tool() -> None:
    script = Script(NS(content=[NS(type="text", text="ok")], stop_reason="end_turn"))
    chat = AnthropicChat(client(script), "claude-opus-5-5", {})
    tool_loop(chat, "sys", [Message(role="user", text="q")], NoTools(), 4)  # type: ignore[arg-type]
    assert all(t.get("name") != "web_search" for t in script.requests[0]["tools"])


def test_sources_already_linked_in_the_answer_are_not_repeated() -> None:
    sources = [("A", "https://a.test"), ("B", "https://b.test")]
    assert (
        with_sources("See https://a.test.", sources)
        == "See https://a.test.\n\nSources:\n- [B](https://b.test)"
    )
    assert with_sources("Nothing.", []) == "Nothing."
