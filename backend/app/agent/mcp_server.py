"""The agent tools as a stdio MCP server, for the Claude Code provider.

Run as ``python -m app.agent.mcp_server`` by the Claude Code CLI (see ``llm/claude_code.py``).
It speaks JSON-RPC 2.0, one JSON message per line on stdin and stdout, and serves exactly
``AgentTools``: the same tools with the same rules (notes wrapped as untrusted content, no
deletes, user-written lessons never overwritten). Each call opens its own database session.

The trace line and a changed lesson cannot cross the process boundary as Python values, so
each result carries them in ``_meta``. Nothing here logs note, lesson, prompt or answer text.
"""

import json
import logging
import os
import sys
import uuid
from collections.abc import Callable, Iterable
from typing import IO, Any

from app.agent.tools import AgentTools, ToolOutcome

LOG = logging.getLogger("learninghub.mcp")

SERVER_NAME = "learninghub"
USER_VARIABLE = "LH_AGENT_USER_ID"
DEFAULT_PROTOCOL = "2025-06-18"
PROTOCOL_VERSIONS = frozenset({"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"})
# Variables the server must never hold, whatever the parent process passes on.
SECRET_VARIABLES = ("CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602

RunTool = Callable[[str, dict[str, Any]], ToolOutcome]


def _is_error(outcome: ToolOutcome) -> bool:
    try:
        data = json.loads(outcome.result)
    except ValueError:
        return False
    return isinstance(data, dict) and "error" in data


def tool_result(outcome: ToolOutcome) -> dict[str, Any]:
    meta: dict[str, Any] = {"summary": outcome.summary}
    if outcome.changed_lesson:
        meta["changed_lesson"] = outcome.changed_lesson
    return {
        "content": [{"type": "text", "text": outcome.result}],
        "isError": _is_error(outcome),
        "_meta": meta,
    }


class McpServer:
    """Answers one JSON-RPC message at a time; ``run_tool`` runs one agent tool."""

    def __init__(self, run_tool: RunTool) -> None:
        self._run_tool = run_tool

    def handle(self, message: Any) -> dict[str, Any] | None:
        """The response to a message, or None for a notification."""
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
            return _error(None, INVALID_REQUEST, "invalid request")
        method = message.get("method")
        request_id = message.get("id")
        is_notification = "id" not in message
        if not isinstance(method, str):
            return None if is_notification else _error(request_id, INVALID_REQUEST, "no method")
        if is_notification:
            return None  # notifications/initialized, notifications/cancelled, ...
        params = message.get("params") or {}
        if not isinstance(params, dict):
            return _error(request_id, INVALID_PARAMS, "params must be an object")
        if method == "initialize":
            return _result(request_id, self.initialize(params))
        if method == "ping":
            return _result(request_id, {})
        if method == "tools/list":
            return _result(request_id, self.tools_list())
        if method == "tools/call":
            name = params.get("name")
            arguments = params.get("arguments") or {}
            if not isinstance(name, str) or not isinstance(arguments, dict):
                return _error(request_id, INVALID_PARAMS, "tools/call needs a name and arguments")
            return _result(request_id, self.tools_call(name, arguments))
        return _error(request_id, METHOD_NOT_FOUND, f"method not found: {method[:100]}")

    @staticmethod
    def initialize(params: dict[str, Any]) -> dict[str, Any]:
        requested = params.get("protocolVersion")
        version = requested if requested in PROTOCOL_VERSIONS else DEFAULT_PROTOCOL
        return {
            "protocolVersion": version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": SERVER_NAME, "version": "1.0.0"},
        }

    @staticmethod
    def tools_list() -> dict[str, Any]:
        return {
            "tools": [
                {"name": s.name, "description": s.description, "inputSchema": s.parameters}
                for s in AgentTools.specs()
            ]
        }

    def tools_call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        try:
            outcome = self._run_tool(name, arguments)
        except Exception as exc:  # the database is down, ...: a tool error, not a crash
            LOG.warning("tool %s failed: %s", name[:100], exc.__class__.__name__)
            outcome = ToolOutcome(
                json.dumps({"error": "the tool failed; try again later"}),
                "Error: the tool failed",
            )
        return tool_result(outcome)


def _result(request_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def serve(server: McpServer, lines: Iterable[bytes], out: IO[bytes]) -> None:
    """Answer each line until the input ends."""
    for raw in lines:
        if not raw.strip():
            continue
        try:
            message = json.loads(raw)
        except ValueError:
            response: dict[str, Any] | None = _error(None, PARSE_ERROR, "parse error")
        else:
            response = server.handle(message)
        if response is not None:
            out.write(json.dumps(response).encode("utf-8") + b"\n")
            out.flush()


def database_tools() -> RunTool:
    """Runs each tool in its own session, on the database and roadmaps of LH_* settings.

    The tools act for the user in ``LH_AGENT_USER_ID``; without a valid id of an existing user
    the server refuses to start (``SystemExit`` with a message on stderr, exit code 1).
    """
    from app.config import Settings
    from app.db import User, make_engine, make_session_factory
    from app.roadmaps import RoadmapCatalog

    raw = os.environ.get(USER_VARIABLE, "").strip()
    if not raw:
        raise SystemExit(f"{USER_VARIABLE} is not set: the tool server needs the user it acts for")
    try:
        user_id = uuid.UUID(raw)
    except ValueError:
        raise SystemExit(f"{USER_VARIABLE} is not a valid user id") from None
    settings = Settings()
    catalog = RoadmapCatalog.load(settings.roadmaps_dir)
    sessions = make_session_factory(make_engine(settings.database_url))
    with sessions() as session:
        if session.get(User, user_id) is None:
            raise SystemExit(f"{USER_VARIABLE} does not name an existing user")

    def run_tool(name: str, arguments: dict[str, Any]) -> ToolOutcome:
        with sessions() as session:
            return AgentTools(session, catalog, user_id=user_id).run(name, arguments)

    return run_tool


def main() -> None:
    for name in SECRET_VARIABLES:
        os.environ.pop(name, None)
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    serve(McpServer(database_tools()), sys.stdin.buffer, sys.stdout.buffer)


if __name__ == "__main__":
    main()
