"""Stand-ins for the Claude Code CLI: no test runs the real ``claude``.

``ReplayRunner`` replays a stream-json fixture recorded in the shape of Claude Code 2.1.302.
``McpRunner`` acts like the CLI around the real MCP server: it starts the server from the
``--mcp-config`` in the command, calls the scripted tools through it and writes the stream
lines Claude Code writes, so tool rules are checked end to end.
"""

import json
import os
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from app.agent.llm.claude_code import ClaudeCodeSetup, ProcessResult
from tests.conftest import TEST_DATABASE_URL

FIXTURES = Path(__file__).parent / "fixtures" / "claude_code"
REPO_ROOT = Path(__file__).resolve().parents[2]
# Any existing program: the fakes never run it, but the agent resolves it like `claude`.
EXISTING_BIN = sys.executable


def setup(**overrides: Any) -> ClaudeCodeSetup:
    values: dict[str, Any] = {
        "database_url": TEST_DATABASE_URL,
        "roadmaps_dir": REPO_ROOT / "roadmaps",
        "storage_dir": REPO_ROOT / "storage",
        "claude_bin": EXISTING_BIN,
    }
    values.update(overrides)
    return ClaudeCodeSetup(**values)


def fixture_lines(name: str, **values: str) -> list[str]:
    text = (FIXTURES / name).read_text(encoding="utf-8")
    for key, value in values.items():
        text = text.replace("{" + key + "}", value)
    return text.splitlines()


class RecordingRunner:
    """Records what the agent would run, and what its working folder held at that time."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def record(
        self,
        argv: Sequence[str],
        env: Mapping[str, str],
        cwd: Path,
        stdin: str,
        timeout: float,
    ) -> None:
        config: dict[str, Any] | None = None
        if "--mcp-config" in argv:
            path = Path(argv[list(argv).index("--mcp-config") + 1])
            config = json.loads(path.read_text(encoding="utf-8"))
        self.calls.append(
            {
                "argv": list(argv),
                "env": dict(env),
                "cwd": cwd,
                "cwd_files": sorted(p.name for p in cwd.iterdir()),
                "stdin": stdin,
                "timeout": timeout,
                "mcp_config": config,
            }
        )

    @property
    def last(self) -> dict[str, Any]:
        return self.calls[-1]


class ReplayRunner(RecordingRunner):
    def __init__(
        self,
        lines: Sequence[str] = (),
        *,
        returncode: int | None = 0,
        stderr: str = "",
        timed_out: bool = False,
        error: Exception | None = None,
    ) -> None:
        super().__init__()
        self.lines = list(lines)
        self.returncode = returncode
        self.stderr = stderr
        self.timed_out = timed_out
        self.error = error
        self.read = 0

    def run(
        self,
        argv: Sequence[str],
        *,
        env: Mapping[str, str],
        cwd: Path,
        stdin: str,
        timeout: float,
        on_line: Callable[[str], bool],
    ) -> ProcessResult:
        self.record(argv, env, cwd, stdin, timeout)
        if self.error is not None:
            raise self.error
        for line in self.lines:
            self.read += 1
            if not on_line(line):
                return ProcessResult(None, self.stderr, stopped=True)
        if self.timed_out:
            return ProcessResult(None, self.stderr, timed_out=True)
        return ProcessResult(self.returncode, self.stderr)


class McpRunner(RecordingRunner):
    """Plays Claude Code: calls ``tools`` (name, arguments) through the real MCP server."""

    def __init__(self, tools: Sequence[tuple[str, dict[str, Any]]], answer: str) -> None:
        super().__init__()
        self.tools = list(tools)
        self.answer = answer
        self.responses: list[dict[str, Any]] = []

    def run(
        self,
        argv: Sequence[str],
        *,
        env: Mapping[str, str],
        cwd: Path,
        stdin: str,
        timeout: float,
        on_line: Callable[[str], bool],
    ) -> ProcessResult:
        self.record(argv, env, cwd, stdin, timeout)
        config = self.last["mcp_config"]
        assert config is not None
        server = config["mcpServers"]["learninghub"]
        server_env = {**os.environ, **server["env"]}
        proc = subprocess.Popen(
            [server["command"], *server["args"]],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            env=server_env,
            cwd=cwd,
        )
        client = McpClient(proc)
        try:
            client.request("initialize", {"protocolVersion": "2025-11-25"})
            client.notify("notifications/initialized")
            listed = [t["name"] for t in client.request("tools/list")["result"]["tools"]]
            on_line(json.dumps(init_line(listed)))
            for number, (name, arguments) in enumerate(self.tools, start=1):
                tool_id = f"toolu_{number}"
                use = assistant_tool_use(tool_id, f"mcp__learninghub__{name}", arguments)
                if not on_line(json.dumps(use)):
                    return ProcessResult(None, stopped=True)
                response = client.request("tools/call", {"name": name, "arguments": arguments})
                self.responses.append(response)
                on_line(json.dumps(user_tool_result(tool_id, response["result"])))
            on_line(json.dumps(result_line(self.answer)))
        finally:
            client.close()
        return ProcessResult(0)


class McpClient:
    """Newline-delimited JSON-RPC over a server's stdin and stdout."""

    def __init__(self, proc: "subprocess.Popen[bytes]") -> None:
        self.proc = proc
        self.next_id = 0

    def send(self, message: Any) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(message).encode() + b"\n")
        self.proc.stdin.flush()

    def send_raw(self, raw: bytes) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(raw + b"\n")
        self.proc.stdin.flush()

    def receive(self) -> dict[str, Any]:
        assert self.proc.stdout is not None
        line = self.proc.stdout.readline()
        assert line, "the MCP server closed its output"
        data: dict[str, Any] = json.loads(line)
        return data

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self.next_id += 1
        message: dict[str, Any] = {"jsonrpc": "2.0", "id": self.next_id, "method": method}
        if params is not None:
            message["params"] = params
        self.send(message)
        response = self.receive()
        assert response["id"] == self.next_id
        return response

    def notify(self, method: str) -> None:
        self.send({"jsonrpc": "2.0", "method": method})

    def close(self) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()
        if self.proc.stdout is not None:
            self.proc.stdout.close()


# --- stream lines in the shape Claude Code 2.1.302 writes ------------------------------------


def init_line(tools: Sequence[str]) -> dict[str, Any]:
    return {
        "type": "system",
        "subtype": "init",
        "tools": [f"mcp__learninghub__{t}" for t in tools],
        "mcp_servers": [{"name": "learninghub", "status": "connected", "source": "dynamic"}],
        "model": "claude-sonnet-5-5",
        "apiKeySource": "none",
        "claude_code_version": "2.1.302",
    }


def assistant_tool_use(tool_id: str, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    block = {"type": "tool_use", "id": tool_id, "name": name, "input": arguments}
    return {"type": "assistant", "message": {"role": "assistant", "content": [block]}}


def user_tool_result(tool_id: str, result: dict[str, Any]) -> dict[str, Any]:
    block: dict[str, Any] = {
        "tool_use_id": tool_id,
        "type": "tool_result",
        "content": result["content"],
    }
    if result.get("isError"):
        block["is_error"] = True
    return {
        "type": "user",
        "message": {"role": "user", "content": [block]},
        "tool_use_result": {"content": result["content"], "_meta": result.get("_meta")},
    }


def result_line(text: str) -> dict[str, Any]:
    return {"type": "result", "subtype": "success", "is_error": False, "result": text}
