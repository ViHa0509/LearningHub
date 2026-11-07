# Evidence log: claude-code-provider

## Manual CLI check

Task 1.5, run by hand on 2026-11-07 on the dev machine (Windows 11, Claude Code 2.1.302 native `claude.exe` from WinGet, signed in with the machine's own login under a non-default `CLAUDE_CONFIG_DIR`; no token was passed). No test runs the real CLI. Three runs that reached the model, all with `--model haiku`, from fresh empty temp folders; plus a few runs that stopped before any model call (empty stdin, or killed right after the `init` line).

| # | What | Result | Wall time |
|---|---|---|---|
| 1 | Plain prompt "Say OK", no MCP config: `-p --output-format stream-json --verbose --input-format text --model haiku --system-prompt … --tools "" --setting-sources "" --no-session-persistence --strict-mcp-config --disable-slash-commands --permission-mode default` | exit 0, answer `OK`, `apiKeySource: none` (machine login) | 5.4 s |
| 2 | Same flags plus `--allowedTools "mcp__learninghub__*" --mcp-config <file>` (server `python -m app.agent.mcp_server` on the dev DB), prompt "Call list_roadmap for backend and answer with the number of topics." | one `tools/call` round trip; answer named 25 topics | 18.1 s (API time 3.4 s) |
| 3 | Run 2 again, through the real adapter (`ClaudeCodeAgent` + `SubprocessRunner`, argv, env and MCP config built by the app code) | trace `list_roadmap {"domain": "backend"}` with summary "Listed the Backend roadmap (25 topics)", not stopped | 21.5 s |

### Flags

- Every flag in design decision 2 is accepted by 2.1.302, including an empty `--setting-sources ""` and an empty `--tools ""`. The `local` fallback for setting sources was not needed.
- `--permission-mode default` is accepted, although `--help` lists only `acceptEdits, auto, bypassPermissions, manual, dontAsk, plan`. An invalid value is refused at parse time (`--permission-mode bogus` exits 1 with the list of choices), so `default` is a recognized, hidden value.
- `--setting-sources bogus` is refused ("Valid options are: user, project, local"), so the empty value is parsed, not ignored by accident.

### Isolation seen in the `init` line

- Run 1: `tools: []`, `mcp_servers: []`, `skills: []`, `slash_commands: []`. Only Claude Code's built-in plugins were listed; no user plugin, hook or MCP server was loaded.
- Run 2: `tools` was exactly the five `mcp__learninghub__*` tools (`list_roadmap`, `read_lesson`, `read_note`, `search_notes`, `write_lesson`); `mcp_servers: [{"name": "learninghub", "status": "connected", "source": "dynamic"}]`. No built-in tool was offered.
- The permission decision for the MCP tool call was `{"decision": "accept", "source": "config", "reason_type": "rule"}`: the `--allowedTools` wildcard rule allowed it without a prompt.
- After the runs, no `lh-claude-*` temp folder and no `app.agent.mcp_server` process was left.

### Stream shape (stream-json, one JSON object per line)

| `type` | Seen | Used by the adapter |
|---|---|---|
| `system` / `subtype: init` | first line; `tools`, `mcp_servers` (with `status`), `model`, `apiKeySource`, `claude_code_version` | tool server status (`connected`; anything but `connected`/`pending` stops the run as `unavailable`) |
| `assistant` | `message.content[]` with `tool_use` blocks (`id`, `name: mcp__learninghub__<tool>`, `input`), `text` blocks, and `thinking` blocks (empty text) | tool calls (step count, trace), last text |
| `rate_limit_event` | `rate_limit_info.status: allowed`, window utilization | ignored |
| `user` | `message.content[]` with `tool_result` (`tool_use_id`, `content: [{type: text, text}]`), plus a top-level `tool_use_result` holding the MCP result **including `_meta`** | summary and changed lesson from `tool_use_result._meta` |
| `system` / `subtype: thinking_tokens` | progress counters | ignored |
| `result` | `subtype: success`, `is_error: false`, `api_error_status: null`, `result` (final text), `num_turns`, `duration_ms`, `terminal_reason: completed` | final text; `is_error`, `subtype`, `api_error_status` for error categories |

- **`_meta` survives**: the MCP server's `_meta` (`summary`, `changed_lesson`) arrives unchanged in the `user` line's `tool_use_result._meta`. It is not inside the `tool_result` block that the model sees. The trailing-marker fallback of design decision 5 was therefore not built; when `_meta` is missing, the step summary is "Called <tool>".
- MCP framing: Claude Code talked newline-delimited JSON-RPC 2.0 over the server's stdin/stdout; `initialize`, `notifications/initialized`, `tools/list` and `tools/call` worked with the server's version echo.
- Error lines were not produced on this machine (signed in, under the limit). The error fixtures (`usage_limit.jsonl`, `not_logged_in.jsonl`, `execution_error.jsonl`) follow the observed `result` shape with `is_error: true`, `api_error_status` 429 or null, and the CLI's known texts ("You've hit your limit …", "Not logged in · Please run /login"); classification also looks at stderr and the exit code.

### Latency

Each run starts the CLI and, with tools, a Python tool server: about 5 s without tools and about 18-22 s for one tool call with Haiku, of which the model API time was about 3.5 s. The default timeout for this type is therefore 300 s (other types keep 60 s).

### One startup race

The first run through the adapter stopped at `init` because the tool server was not reported as connected (likely a cold Python start). Four later attempts all reported `connected`. The adapter now sets `MCP_TIMEOUT=30000` for the CLI (only when not already set), treats `pending` as not failed, and names the status in the `unavailable` message.

## Dev -> QC -> verify

| Step | Agent (model) | Result |
|---|---|---|
| Specs, design | main session (opus) | `openspec validate --strict` pass |
| Backend 1.1-1.5 | implementer (opus; subprocess and tool exposure are security-sensitive) | 337 backend tests; 3 manual runs of the real CLI (Haiku) recorded above |
| Frontend 2.1 | implementer (sonnet), in parallel | 133 Vitest tests |
| E2E 3.1 | qc-e2e (sonnet) | `fake_claude.py`, which drives the real MCP server, and `claude-code.e2e.ts` (10 tests); **56/56 pass** in round 1, no product bugs |
| Verify 3.2 | verifier (sonnet) | **pass**: every check green (337 / lint / types / 133 / lint / build / 56 e2e); every scenario mapped to a test; security review found nothing blocking |

Verifier notes, not fixed:
- The database URL, which may hold a password, is written to `mcp.json` in the temp run folder for the MCP server. The folder is deleted after the run. For a local single-user app this is accepted by design.
- Refusing a model name that starts with `-` is tested but not written as a spec scenario.
