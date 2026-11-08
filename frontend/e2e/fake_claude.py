"""A fake `claude` CLI for the e2e checks of the claude-code-provider change.

The backend runs it (LH_CLAUDE_BIN points here) the way it runs the real CLI: the conversation
arrives on stdin, `--model` picks the scripted behaviour, `--mcp-config` names the MCP config
of the app's tool server. Tool calls go through the REAL tool server (JSON-RPC over stdio), and
the stream lines are the ones Claude Code writes (stream-json). Never calls any real service.

Models: sonnet (search + read the notes, then answer), fake-write (write the lesson named in
the message), fake-429 (usage limit), fake-auth (not logged in), fake-slow (sleeps).

Internet search: when the backend allowed the built-in WebSearch (`--tools WebSearch`) and
the message asks to "search the web", the default run also emits a WebSearch tool_use and
its tool_result (synthetic example.test links, the shape Claude Code writes) before the
answer, which lists the URLs under "Sources". Nothing is searched for real.
"""

import json
import os
import re
import subprocess
import sys
import time


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def arg(name: str) -> str | None:
    argv = sys.argv
    return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else None


class Mcp:
    def __init__(self, config_path: str) -> None:
        with open(config_path, encoding="utf-8") as f:
            server = json.load(f)["mcpServers"]["learninghub"]
        self.proc = subprocess.Popen(
            [server["command"], *server["args"]],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            env={**os.environ, **server["env"]},
        )
        self.next_id = 0
        self.request("initialize", {"protocolVersion": "2025-11-25"})
        self.send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def send(self, message: dict) -> None:
        self.proc.stdin.write(json.dumps(message).encode() + b"\n")
        self.proc.stdin.flush()

    def request(self, method: str, params: dict | None = None) -> dict:
        self.next_id += 1
        message = {"jsonrpc": "2.0", "id": self.next_id, "method": method}
        if params is not None:
            message["params"] = params
        self.send(message)
        return json.loads(self.proc.stdout.readline())

    def close(self) -> None:
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.proc.kill()


class Run:
    def __init__(self, mcp: Mcp) -> None:
        self.mcp = mcp
        self.count = 0

    def call(self, name: str, arguments: dict) -> dict:
        self.count += 1
        tool_id = f"toolu_{self.count}"
        emit(
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": tool_id,
                            "name": f"mcp__learninghub__{name}",
                            "input": arguments,
                        }
                    ],
                },
            }
        )
        result = self.mcp.request("tools/call", {"name": name, "arguments": arguments})["result"]
        block = {"type": "tool_result", "tool_use_id": tool_id, "content": result["content"]}
        emit(
            {
                "type": "user",
                "message": {"role": "user", "content": [block]},
                "tool_use_result": {"content": result["content"], "_meta": result.get("_meta")},
            }
        )
        return result


    def web_search(self, query: str) -> list[dict]:
        """A built-in WebSearch use and its result, as Claude Code streams them."""
        self.count += 1
        tool_id = f"toolu_{self.count}"
        emit(
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": tool_id,
                            "name": "WebSearch",
                            "input": {"query": query, "mode": "standard"},
                        }
                    ],
                },
            }
        )
        links = [
            {"title": f"Fake web result about {query}", "url": "https://example.test/fake-web-result"},
            {"title": "Second fake web result", "url": "https://example.test/second-result"},
        ]
        text = (
            f'Web search results for query: "{query}"\n\n'
            f"Links: {json.dumps(links)}\n\n"
            "REMINDER: You MUST include the sources above in your response to the user."
        )
        emit(
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [{"type": "tool_result", "tool_use_id": tool_id, "content": text}],
                },
                "tool_use_result": {"query": query, "results": [{"content": links}]},
            }
        )
        return links


def finish(text: str) -> None:
    emit({"type": "result", "subtype": "success", "is_error": False, "result": text})


def main() -> int:
    conversation = sys.stdin.read()
    model = arg("--model") or ""
    config = arg("--mcp-config")
    if model == "fake-429":
        emit(
            {
                "type": "result",
                "subtype": "success",
                "is_error": True,
                "api_error_status": 429,
                "result": "You've hit your limit",
            }
        )
        return 1
    if model == "fake-auth":
        emit(
            {
                "type": "result",
                "subtype": "success",
                "is_error": True,
                "api_error_status": None,
                "result": "Not logged in · Please run /login",
            }
        )
        return 1
    if model == "fake-slow":
        time.sleep(120)
        return 0
    if config is None:  # Test Connection: no tools
        finish("OK")
        return 0

    web = arg("--tools") == "WebSearch" and "search the web" in conversation.lower()
    mcp = Mcp(config)
    try:
        emit(
            {
                "type": "system",
                "subtype": "init",
                "tools": (["WebSearch"] if arg("--tools") == "WebSearch" else [])
                + [f"mcp__learninghub__{t}" for t in ("list_roadmap", "read_lesson", "read_note", "search_notes", "write_lesson")],
                "mcp_servers": [{"name": "learninghub", "status": "connected"}],
                "model": model,
            }
        )
        run = Run(mcp)
        if model == "fake-write":
            found = re.search(r"\(([a-z0-9-]+/[a-z0-9-]+)\)", conversation)
            node = found.group(1) if found else "backend/caching"
            run.call("write_lesson", {"node_id": node, "markdown": "# Drafted by the fake CLI\n\nCaching keeps hot data close."})
            finish(f"I wrote the lesson for {node}.")
            return 0
        question = conversation.lower()
        query = "redis" if "redis" in question else (re.findall(r"[a-z]{5,}", question) or ["notes"])[-1]
        searched = run.call("search_notes", {"query": query})
        notes = json.loads(searched["content"][0]["text"]).get("notes", [])
        if web:
            links = run.web_search(f"{query} latest news")
            sources = "\n".join(f"- {link['url']}" for link in links)
            finish(f"From the web: fake findings about {query}. FAKE-CLAUDE-ANSWER\n\nSources:\n{sources}")
            return 0
        if notes:
            read = run.call("read_note", {"note_id": notes[0]["id"]})
            title = json.loads(read["content"][0]["text"]).get("title", "")
            finish(f"From your notes: {title}. FAKE-CLAUDE-ANSWER")
        else:
            finish("I found no notes. FAKE-CLAUDE-ANSWER")
        return 0
    finally:
        mcp.close()


if __name__ == "__main__":
    raise SystemExit(main())
