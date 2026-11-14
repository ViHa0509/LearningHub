"""Claude Code (subscription): the agent runs inside the installed ``claude`` CLI.

Claude Code runs its own agent loop, so ``ClaudeCodeAgent`` takes the whole request
(``run``) instead of one model turn. The app's tools reach it only through the MCP server
``app.agent.mcp_server``, started by the CLI for the run. The run is isolated: built-in
tools off, only ``mcp__learninghub__*`` allowed, strict MCP configuration, no setting
sources, no saved session, a fresh empty working folder. With the agent's Internet search
switch on, the one built-in tool WebSearch is allowed as well (it runs on Anthropic's
side and returns titles and URLs); WebFetch and every other built-in tool stay off. The
optional setup token goes into the process environment only, never into the arguments, a log
or a message.

The process runner is injected so tests replay recorded stream-json output; no test runs
the real CLI.
"""

import contextlib
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, TYPE_CHECKING, Any, Protocol

from app.agent.llm import catalog
from app.agent.llm.errors import ErrorCategory, ProviderError
from app.agent.messages import Message, ToolSpec, Turn
from app.agent.results import AgentResult, Step, stopped_reply

if TYPE_CHECKING:
    from app.agent.tools import AgentTools
    from app.config import Settings

PROVIDER_TYPE = "claude-code"
SERVER_NAME = "learninghub"
TOOL_PREFIX = f"mcp__{SERVER_NAME}__"
# The only built-in tool a run may get, and only with the agent's Internet search on.
WEB_SEARCH_TOOL = "WebSearch"
WEB_SEARCH_STEP = "web_search"
MAX_QUERY = 120
DEFAULT_TIMEOUT = 300.0
BACKEND_DIR = Path(__file__).resolve().parents[3]

NOT_INSTALLED = "Claude Code is not installed (claude not found)"
UNSAFE_SCRIPT = (
    "Claude Code was found as a .cmd/.bat script, which cannot be run safely; "
    "install the native claude executable or set LH_CLAUDE_BIN"
)
NOT_SIGNED_IN = (
    "Claude Code is not signed in or its token is invalid: run 'claude' on this machine "
    "and log in, or save a new token from 'claude setup-token'"
)
USAGE_LIMIT = "Claude Code reports that the usage or rate limit is reached"
BAD_MODEL = "Claude Code does not know this model"
NO_TOOL_SERVER = "the Learning Hub tool server did not start for Claude Code"

# Never inherited: an API key from elsewhere must not be billed by mistake.
SECRET_ENV = frozenset({"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"})
# Set when the backend itself was started from a Claude Code session; the run must not join it.
SESSION_ENV = frozenset(
    {
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_CODE_CHILD_SESSION",
        "CLAUDE_CODE_SESSION_ATTENDED",
        "CLAUDE_CODE_MESSAGING_SOCKET",
        "CLAUDE_CODE_MESSAGING_TOKEN",
        "CLAUDE_CODE_EXECPATH",
        "CLAUDE_PID",
    }
)

AUTH_TEXT = re.compile(
    r"not logged in|please run /login|invalid api key|oauth|authenticat|unauthori[sz]ed"
    r"|token (?:has )?expired|invalid (?:bearer |access )?token|credit balance"
)
LIMIT_TEXT = re.compile(r"usage limit|rate.?limit|hit your limit|limit reached|\b429\b")
MODEL_TEXT = re.compile(r"selected model|model.{0,40}(?:not found|not exist|invalid)")
MCP_STARTUP_MS = "30000"
MAX_STDERR = 4000
MAX_SUMMARY = 300


# --- the process runner ---------------------------------------------------------------


@dataclass(frozen=True)
class ProcessResult:
    returncode: int | None
    stderr: str = field(default="", repr=False)
    timed_out: bool = False
    stopped: bool = False


class ProcessRunner(Protocol):
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
        """Run ``argv``; give each stdout line to ``on_line`` until it returns False.

        Kills the whole process tree at the deadline (``timed_out``) or when ``on_line``
        returns False (``stopped``). Raises FileNotFoundError when the program is missing.
        """
        ...


def kill_tree(proc: "subprocess.Popen[bytes]") -> None:
    """Stop the process and everything it started (the MCP server, ...)."""
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", str(proc.pid)],
            capture_output=True,
            timeout=15,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    else:
        import signal

        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    with contextlib.suppress(OSError):
        proc.kill()


class SubprocessRunner:
    """The real runner: ``subprocess.Popen`` with an argument list, never a shell."""

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
        deadline = time.monotonic() + timeout
        if sys.platform == "win32":
            flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
            proc = subprocess.Popen(
                list(argv),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=cwd,
                env=dict(env),
                creationflags=flags,
            )
        else:
            proc = subprocess.Popen(
                list(argv),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=cwd,
                env=dict(env),
                start_new_session=True,
            )
        assert proc.stdin is not None and proc.stdout is not None and proc.stderr is not None
        lines: queue.Queue[bytes | None] = queue.Queue()
        stderr: list[bytes] = []

        def write_stdin(pipe: IO[bytes]) -> None:
            try:
                pipe.write(stdin.encode("utf-8"))
                pipe.close()
            except OSError:
                pass

        def read_stdout(pipe: IO[bytes]) -> None:
            for raw in pipe:
                lines.put(raw)
            lines.put(None)

        def read_stderr(pipe: IO[bytes]) -> None:
            kept = b""
            for chunk in iter(lambda: pipe.read(4096), b""):
                kept = (kept + chunk)[-MAX_STDERR:]
            stderr.append(kept)

        threads = [
            threading.Thread(target=write_stdin, args=(proc.stdin,), daemon=True),
            threading.Thread(target=read_stdout, args=(proc.stdout,), daemon=True),
            threading.Thread(target=read_stderr, args=(proc.stderr,), daemon=True),
        ]
        for thread in threads:
            thread.start()
        timed_out = stopped = False
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break
            try:
                item = lines.get(timeout=remaining)
            except queue.Empty:
                timed_out = True
                break
            if item is None:  # stdout closed
                break
            if not on_line(item.decode("utf-8", errors="replace")):
                stopped = True
                break
        if not stopped and not timed_out:
            try:
                proc.wait(timeout=max(deadline - time.monotonic(), 0.1))
            except subprocess.TimeoutExpired:
                timed_out = True
        if stopped or timed_out:
            kill_tree(proc)
        try:
            returncode: int | None = proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            returncode = None
        for thread in threads:
            thread.join(timeout=5)
        for pipe in (proc.stdin, proc.stdout, proc.stderr):
            with contextlib.suppress(OSError):
                pipe.close()
        text = b"".join(stderr).decode("utf-8", errors="replace")
        return ProcessResult(returncode, text, timed_out=timed_out, stopped=stopped)


# --- setup, command and environment ----------------------------------------------------


@dataclass(frozen=True)
class ClaudeCodeSetup:
    """Where the MCP server finds the app's data, and an optional ``claude`` override."""

    database_url: str = field(repr=False)
    roadmaps_dir: Path
    storage_dir: Path
    claude_bin: str | None = None
    python: str = sys.executable

    @classmethod
    def from_settings(cls, settings: "Settings") -> "ClaudeCodeSetup":
        return cls(
            database_url=settings.database_url,
            roadmaps_dir=Path(settings.roadmaps_dir).resolve(),
            storage_dir=Path(settings.storage_dir).resolve(),
            claude_bin=settings.claude_bin or None,
        )


def render_conversation(messages: Sequence[Message]) -> str:
    """The text sent on stdin: earlier turns as a transcript, then the new user message."""
    turns = [m for m in messages if m.role in ("user", "assistant")]
    if not turns:
        return ""
    *earlier, last = turns
    if not earlier:
        return last.text
    transcript = "\n\n".join(
        f"{'User' if m.role == 'user' else 'Assistant'}: {m.text}" for m in earlier
    )
    return (
        "The conversation so far:\n\n"
        f"{transcript}\n\n"
        "The user's new message, to answer now:\n\n"
        f"{last.text}"
    )


def mcp_config(setup: ClaudeCodeSetup, user_id: uuid.UUID | None = None) -> dict[str, Any]:
    """The MCP configuration of one run: only the app's tool server, with only what it needs.

    ``LH_AGENT_USER_ID`` names the user the tools act for; the server refuses to start without
    it, so a run without a user (``None``) has no working tools.
    """
    env = {
        "LH_DATABASE_URL": setup.database_url,
        "LH_ROADMAPS_DIR": str(setup.roadmaps_dir),
        "LH_STORAGE_DIR": str(setup.storage_dir),
        "PYTHONPATH": str(BACKEND_DIR),
    }
    if user_id is not None:
        env["LH_AGENT_USER_ID"] = str(user_id)
    return {
        "mcpServers": {
            SERVER_NAME: {
                "type": "stdio",
                "command": setup.python,
                "args": ["-m", "app.agent.mcp_server"],
                "env": env,
            }
        }
    }


def build_env(
    environ: Mapping[str, str], token: str | None, config_dir: str | None
) -> dict[str, str]:
    env = {
        name: value
        for name, value in environ.items()
        if name.upper() not in SECRET_ENV and name.upper() not in SESSION_ENV
    }
    if token:
        env["CLAUDE_CODE_OAUTH_TOKEN"] = token
    if config_dir:
        env["CLAUDE_CONFIG_DIR"] = config_dir
    # The tool server is a Python process; a cold start can take a few seconds.
    env.setdefault("MCP_TIMEOUT", MCP_STARTUP_MS)
    return env


# --- reading the stream -------------------------------------------------------------------


def _tool_name(name: str) -> str:
    if name == WEB_SEARCH_TOOL:
        return WEB_SEARCH_STEP
    return name[len(TOOL_PREFIX) :] if name.startswith(TOOL_PREFIX) else name


def _search_query(args: dict[str, Any]) -> str:
    query = " ".join(str(args.get("query") or "").split())
    return query if len(query) <= MAX_QUERY else query[: MAX_QUERY - 1] + "\u2026"


class StreamReader:
    """Collects the trace and the result from stream-json lines; unknown lines are skipped."""

    def __init__(self, max_steps: int, with_tools: bool) -> None:
        self.max_steps = max_steps
        self.with_tools = with_tools
        self.steps: list[Step] = []
        self.changed_lessons: list[str] = []
        self.changed_notes: list[str] = []
        self.tool_uses = 0
        self.over_limit = False
        self.server_failed = False
        self.server_status = ""
        self.result: dict[str, Any] | None = None
        self.last_text = ""
        self._pending: dict[str, tuple[str, dict[str, Any]]] = {}

    def feed(self, line: str) -> bool:
        """Read one line; False asks the runner to stop the process."""
        try:
            data = json.loads(line)
        except ValueError:
            return True
        if not isinstance(data, dict):
            return True
        kind = data.get("type")
        if kind == "system" and data.get("subtype") == "init":
            return self._init(data)
        if kind == "assistant":
            return self._assistant(data)
        if kind == "user":
            self._user(data)
        elif kind == "result":
            self.result = data
        return True

    def _init(self, data: dict[str, Any]) -> bool:
        if not self.with_tools:
            return True
        for server in data.get("mcp_servers") or []:
            if (
                isinstance(server, dict)
                and server.get("name") == SERVER_NAME
                and server.get("status") not in ("connected", "pending")
            ):
                self.server_status = re.sub(r"[^a-z-]", "", str(server.get("status")).lower())[:20]
                self.server_failed = True
                return False
        return True

    def _assistant(self, data: dict[str, Any]) -> bool:
        message = data.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        for block in content if isinstance(content, list) else []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text" and isinstance(block.get("text"), str):
                self.last_text = block["text"]
            elif block.get("type") == "tool_use":
                self.tool_uses += 1
                if self.tool_uses > self.max_steps:
                    self.over_limit = True
                    return False
                raw_input = block.get("input")
                args = raw_input if isinstance(raw_input, dict) else {}
                tool = _tool_name(str(block.get("name") or ""))
                if tool == WEB_SEARCH_STEP:
                    args = {"query": _search_query(args)}
                self._pending[str(block.get("id"))] = (tool, args)
        return True

    def _user(self, data: dict[str, Any]) -> None:
        message = data.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        results = [
            b
            for b in (content if isinstance(content, list) else [])
            if isinstance(b, dict) and b.get("type") == "tool_result"
        ]
        # The MCP server's _meta arrives with the line's tool_use_result (one result per line).
        extra = data.get("tool_use_result")
        meta = extra.get("_meta") if isinstance(extra, dict) else None
        meta = meta if isinstance(meta, dict) and len(results) == 1 else {}
        for block in results:
            pending = self._pending.pop(str(block.get("tool_use_id")), None)
            if pending is None:
                continue
            tool, args = pending
            if tool == WEB_SEARCH_STEP:
                # A built-in tool: no app _meta; the result text is untrusted web data.
                searched = f"Searched the web for '{args['query']}'"
                if block.get("is_error"):
                    searched += " (error)"
                self.steps.append(Step(tool=tool, input=args, summary=searched[:MAX_SUMMARY]))
                continue
            summary = meta.get("summary")
            if not isinstance(summary, str) or not summary.strip():
                summary = f"Called {tool}" + (" (error)" if block.get("is_error") else "")
            self.steps.append(Step(tool=tool, input=args, summary=summary[:MAX_SUMMARY]))
            changed = meta.get("changed_lesson")
            if isinstance(changed, str) and changed and changed not in self.changed_lessons:
                self.changed_lessons.append(changed)
            saved = meta.get("changed_note")
            if isinstance(saved, str) and saved and saved not in self.changed_notes:
                self.changed_notes.append(saved)


def classify(result: dict[str, Any] | None, stderr: str, returncode: int | None) -> ProviderError:
    """A failed run as a categorized error; the message is fixed text, never CLI output."""
    result = result or {}
    status = result.get("api_error_status")
    errors = result.get("errors")
    text = " ".join(
        [
            str(result.get("result") or ""),
            " ".join(str(e) for e in errors) if isinstance(errors, list) else "",
            stderr,
        ]
    ).lower()
    category: ErrorCategory
    if status in (401, 403) or AUTH_TEXT.search(text):
        category, message = "auth_failed", NOT_SIGNED_IN
    elif status == 429 or LIMIT_TEXT.search(text):
        category, message = "rate_limited", USAGE_LIMIT
    elif status == 404 or MODEL_TEXT.search(text):
        category, message = "invalid_model", BAD_MODEL
    else:
        subtype = result.get("subtype")
        if isinstance(subtype, str) and subtype and subtype != "success":
            reason = re.sub(r"[^a-z_]", "", subtype.lower())[:40]
        elif isinstance(status, int):
            reason = f"API status {status}"
        elif returncode not in (0, None):
            reason = f"exit code {returncode}"
        else:
            reason = "no answer"
        category, message = "unavailable", f"Claude Code failed ({reason})"
    return ProviderError(message, category)


# --- the agent --------------------------------------------------------------------------


class ClaudeCodeAgent:
    """A chat model that runs its own agent loop in the Claude Code CLI."""

    runs_own_loop = True

    def __init__(
        self,
        model: str,
        setup: ClaudeCodeSetup,
        runner: ProcessRunner,
        *,
        token: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        config_dir: str | None = None,
        which: Callable[[str], str | None] = shutil.which,
        environ: Mapping[str, str] | None = None,
    ) -> None:
        self.model = model
        self._setup = setup
        self._runner = runner
        self._token = token
        self._timeout = timeout
        self._config_dir = config_dir
        self._which = which
        self._environ = environ

    def __repr__(self) -> str:  # never shows the token
        return f"ClaudeCodeAgent(model={self.model!r})"

    def executable(self) -> list[str]:
        configured = self._setup.claude_bin
        if configured and configured.lower().endswith(".py"):
            # A Python script (the e2e fake) runs with this interpreter.
            if not Path(configured).is_file():
                raise ProviderError(NOT_INSTALLED, "invalid_config")
            return [sys.executable, configured]
        found = self._which(configured or "claude")
        if not found:
            raise ProviderError(NOT_INSTALLED, "invalid_config")
        if Path(found).suffix.lower() in (".cmd", ".bat"):
            raise ProviderError(UNSAFE_SCRIPT, "invalid_config")
        return [found]

    def command(
        self, system: str, mcp_config_path: Path | None, web_search: bool = False
    ) -> list[str]:
        """No built-in tool, or only WebSearch when ``web_search`` (never WebFetch)."""
        builtin = WEB_SEARCH_TOOL if web_search else ""
        argv = [
            *self.executable(),
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--input-format",
            "text",
            "--model",
            self.model,
            "--system-prompt",
            system,
            "--tools",
            builtin,
        ]
        allowed = [WEB_SEARCH_TOOL] if web_search else []
        if mcp_config_path is not None:
            allowed.append(f"{TOOL_PREFIX}*")
        if allowed:
            argv += ["--allowedTools", ",".join(allowed)]
        if mcp_config_path is not None:
            argv += ["--mcp-config", str(mcp_config_path)]
        argv += [
            "--strict-mcp-config",
            "--setting-sources",
            "",
            "--no-session-persistence",
            "--disable-slash-commands",
            "--permission-mode",
            "default",
        ]
        return argv

    def _run(
        self,
        system: str,
        messages: Sequence[Message],
        max_steps: int,
        with_tools: bool,
        web_search: bool = False,
        user_id: uuid.UUID | None = None,
    ) -> AgentResult:
        if not self.model or self.model.startswith("-"):
            raise ProviderError("the model name cannot start with '-'", "invalid_config")
        reader = StreamReader(max_steps, with_tools)
        folder = Path(tempfile.mkdtemp(prefix="lh-claude-"))
        try:
            work = folder / "work"
            work.mkdir()
            config_path: Path | None = None
            if with_tools:
                config_path = folder / "mcp.json"
                config_path.write_text(
                    json.dumps(mcp_config(self._setup, user_id)), encoding="utf-8"
                )
            argv = self.command(system, config_path, web_search)
            env = build_env(
                os.environ if self._environ is None else self._environ,
                self._token,
                self._config_dir,
            )
            try:
                outcome = self._runner.run(
                    argv,
                    env=env,
                    cwd=work,
                    stdin=render_conversation(messages),
                    timeout=self._timeout,
                    on_line=reader.feed,
                )
            except FileNotFoundError as exc:
                raise ProviderError(NOT_INSTALLED, "invalid_config") from exc
            except OSError as exc:
                raise ProviderError(
                    f"Claude Code could not be started ({exc.__class__.__name__})", "unavailable"
                ) from exc
        finally:
            shutil.rmtree(folder, ignore_errors=True)
        if outcome.timed_out:
            raise ProviderError(f"Claude Code did not answer within {self._timeout:g} s", "timeout")
        if reader.over_limit:
            return AgentResult(
                reply=stopped_reply(max_steps),
                steps=reader.steps,
                changed_lessons=reader.changed_lessons,
                changed_notes=reader.changed_notes,
                stopped=True,
            )
        if reader.server_failed:
            raise ProviderError(f"{NO_TOOL_SERVER} ({reader.server_status})", "unavailable")
        result = reader.result
        if result is None or result.get("is_error") or result.get("subtype") != "success":
            raise classify(result, outcome.stderr, outcome.returncode)
        text = result.get("result")
        reply = text if isinstance(text, str) and text.strip() else reader.last_text
        return AgentResult(
            reply=reply or "(The model gave an empty answer.)",
            steps=reader.steps,
            changed_lessons=reader.changed_lessons,
            changed_notes=reader.changed_notes,
        )

    def run(
        self,
        system: str,
        conversation: Sequence[Message],
        tools: "AgentTools | None",
        max_steps: int,
        *,
        web_search: bool = False,
    ) -> AgentResult:
        """The whole request in one CLI run; the tools come from the MCP server, not ``tools``.

        ``web_search`` (the agent's Internet search switch) adds WebSearch and its prompt.
        """
        if web_search:
            from app.agent.loop import with_web_search  # the loop imports this module

            system = with_web_search(system)
        return self._run(
            system,
            conversation,
            max_steps,
            with_tools=True,
            web_search=web_search,
            user_id=tools.user_id if tools is not None else None,
        )

    def complete(self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec]) -> Turn:
        """One answer without any tool (the connection test)."""
        return Turn(text=self._run(system, messages, max_steps=0, with_tools=False).reply)

    def list_models(self) -> list[str]:
        return [m.id for m in catalog.presets(PROVIDER_TYPE)]
