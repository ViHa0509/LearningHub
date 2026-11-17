"""Spec: kh-connector, scenario "Claude Code provider": the app's MCP server offers kh_search to
a connected user, and only to a connected user.

Knowledge Hub and its identity service are a local server on 127.0.0.1; nothing leaves the PC."""

import json
import os
import subprocess
import sys
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from app.agent.llm.claude_code import ClaudeCodeSetup, mcp_config
from app.agent.mcp_server import McpServer
from app.agent.messages import ToolSpec
from app.agent.tools import KH_TOOL, SPECS
from tests import test_kh_connector
from tests.claude_code_fakes import McpClient
from tests.conftest import BACKEND_DIR, TEST_DATABASE_URL, user_id_of
from tests.test_kh_connector import Kit

kit = test_kh_connector.kit


class LocalKh:
    def __init__(self) -> None:
        self.requests: list[tuple[str, str | None, dict[str, Any] | None]] = []


def handler_for(state: LocalKh) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            body = (
                json.loads(raw) if self.headers.get("Content-Type") == "application/json" else None
            )
            state.requests.append((self.path, self.headers.get("Authorization"), body))
            if self.path.endswith("/protocol/openid-connect/token"):
                answer: dict[str, Any] = {"access_token": "LOCAL-ACCESS", "refresh_token": "R-2"}
            else:
                answer = {"status": "done", "text": "from the local kh"}
            payload = json.dumps(answer).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args: Any) -> None:
            pass

    return Handler


@pytest.fixture
def local_kh() -> Iterator[tuple[str, LocalKh]]:
    state = LocalKh()
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(state))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", state
    finally:
        server.shutdown()
        server.server_close()


def start_server(kit: Kit, extra: dict[str, str]) -> tuple[McpClient, "subprocess.Popen[bytes]"]:
    env = {
        **os.environ,
        "LH_AGENT_USER_ID": str(user_id_of(kit.app)),
        "LH_DATABASE_URL": TEST_DATABASE_URL,
        "LH_STORAGE_DIR": str(Path(kit.app.state.settings.storage_dir)),
        "PYTHONPATH": str(BACKEND_DIR),
        **extra,
    }
    for name in ("LH_KH_URL", "LH_KH_ISSUER", "LH_KH_CLIENT_ID"):
        if name not in extra:
            env.pop(name, None)
    proc = subprocess.Popen(
        [sys.executable, "-m", "app.agent.mcp_server"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        cwd=BACKEND_DIR,
    )
    return McpClient(proc), proc


def stop(client: McpClient, proc: "subprocess.Popen[bytes]") -> None:
    client.close()
    assert proc.stderr is not None
    proc.stderr.close()


def kh_env(base: str) -> dict[str, str]:
    return {
        "LH_KH_URL": base,
        "LH_KH_ISSUER": f"{base}/realms/kh",
        "LH_KH_CLIENT_ID": "learning-hub-test",
    }


def names(client: McpClient) -> list[str]:
    return [t["name"] for t in client.request("tools/list")["result"]["tools"]]


def test_the_server_object_lists_kh_search_only_when_offered() -> None:
    def run(name: str, arguments: dict[str, Any]) -> Any:
        raise AssertionError("no call")

    assert KH_TOOL in [s.name for s in SPECS]
    off = McpServer(run).tools_list()["tools"]
    on = McpServer(run, None, lambda: True).tools_list()["tools"]
    assert KH_TOOL not in [t["name"] for t in off]
    assert KH_TOOL in [t["name"] for t in on]
    unticked = McpServer(run, {"read_note"}, lambda: True).tools_list()["tools"]
    assert [t["name"] for t in unticked] == ["read_note"]
    assert isinstance(SPECS[0], ToolSpec)


def test_the_mcp_config_passes_the_connector_settings_and_no_secret(tmp_path: Path) -> None:
    setup = ClaudeCodeSetup(
        database_url="postgresql://x",
        roadmaps_dir=tmp_path,
        storage_dir=tmp_path,
        kh_url="https://kh.test",
        kh_issuer="https://idp.test/realms/kh",
        kh_client_id="learning-hub",
    )
    env = mcp_config(setup, None, None)["mcpServers"]["learninghub"]["env"]
    assert env["LH_KH_URL"] == "https://kh.test"
    assert env["LH_KH_ISSUER"] == "https://idp.test/realms/kh"
    assert env["LH_KH_CLIENT_ID"] == "learning-hub"
    plain = ClaudeCodeSetup(
        database_url="postgresql://x", roadmaps_dir=tmp_path, storage_dir=tmp_path
    )
    env = mcp_config(plain, None, None)["mcpServers"]["learninghub"]["env"]
    assert not [k for k in env if k.startswith("LH_KH")]


def test_a_connected_user_is_offered_kh_search_and_can_call_it(
    kit: Kit, local_kh: tuple[str, LocalKh]
) -> None:
    base, state = local_kh
    kit.connect_and_approve()
    client, proc = start_server(kit, kh_env(base))
    try:
        assert KH_TOOL in names(client)
        result = client.request(
            "tools/call", {"name": KH_TOOL, "arguments": {"query": "redis eviction"}}
        )["result"]
        assert result["isError"] is False
        text = json.loads(result["content"][0]["text"])["text"]
        assert text.startswith('<untrusted_kh_content project="p-1">')
        assert "from the local kh" in text
        search = [r for r in state.requests if r[0].endswith("/run")]
        assert search[0][1] == "Bearer LOCAL-ACCESS"
        assert search[0][2] == {"input": {"text": "redis eviction", "space": "p-1"}}
    finally:
        stop(client, proc)


def test_a_user_who_is_not_connected_is_not_offered_kh_search(
    kit: Kit, local_kh: tuple[str, LocalKh]
) -> None:
    base, _ = local_kh
    client, proc = start_server(kit, kh_env(base))
    try:
        assert KH_TOOL not in names(client)
        refused = client.request("tools/call", {"name": KH_TOOL, "arguments": {"query": "x"}})
        assert refused["result"]["isError"] is True
    finally:
        stop(client, proc)


def test_without_the_connector_settings_kh_search_is_not_offered(kit: Kit) -> None:
    kit.connect_and_approve()
    client, proc = start_server(kit, {})
    try:
        assert KH_TOOL not in names(client)
    finally:
        stop(client, proc)


def test_the_area_limit_still_applies_to_kh_search(kit: Kit, local_kh: tuple[str, LocalKh]) -> None:
    base, _ = local_kh
    kit.connect_and_approve()
    client, proc = start_server(kit, {**kh_env(base), "LH_AGENT_TOOLS": "read_note"})
    try:
        assert names(client) == ["read_note"]
        refused = client.request("tools/call", {"name": KH_TOOL, "arguments": {"query": "x"}})
        assert refused["result"]["isError"] is True
    finally:
        stop(client, proc)
