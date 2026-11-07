## Context

Every provider today is an HTTP adapter (`ChatModel.complete`) driven turn by turn by `run_agent`, which runs the tools itself. Claude Code is different: it runs its own agent loop and can only reach outside tools through MCP. The installed CLI here is 2.1.302 (`claude --help` checked on 2026-11-07). It has `-p`, `--output-format stream-json` with `--verbose`, `--input-format`, `--model`, `--system-prompt`, `--tools ""`, `--allowedTools`, `--mcp-config` with `--strict-mcp-config`, `--setting-sources`, `--no-session-persistence`, `--disable-slash-commands` and `--permission-mode`. There is no max-turns flag. `--bare` cannot be used, because it reads only `ANTHROPIC_API_KEY` and never OAuth, so a subscription would not work with it.

## Goals / Non-Goals

**Goals:** the subscription answers the same chat, with the same tools and trace, safely isolated from the user's own Claude Code setup.

**Non-Goals:** streaming replies; reusing Claude Code sessions across turns (every request sends the whole conversation); cost reporting.

## Decisions

1. **A "runs its own loop" chat model.** `ClaudeCodeAgent` gets `run(system, conversation, page_tools_spec, max_steps) -> AgentResult` instead of `complete`. `run_agent` checks for it (a `runs_own_loop` attribute) and delegates, so the chat route, fallback (`resolve.py`) and answer shape stay as they are. Fallback works because the run raises `ProviderError` with a category, as other adapters do.
2. **Command.** Built as an argument list and run with `subprocess.Popen` (never `shell=True`). The executable is `shutil.which(settings.claude_bin or "claude")`; `LH_CLAUDE_BIN` overrides it (used by e2e).
   - Arguments: `-p --output-format stream-json --verbose --input-format text --model <model> --system-prompt <app system prompt> --tools "" --allowedTools mcp__learninghub__* --mcp-config <temp json> --strict-mcp-config --setting-sources "" --no-session-persistence --disable-slash-commands --permission-mode default`.
   - Check on this machine that an empty `--setting-sources` loads nothing. If the CLI rejects an empty value, use the narrowest one that loads nothing from an empty working folder (`local`), and record the result in evidence.
   - The conversation goes on stdin as text: earlier turns are rendered as a transcript ("User: …", "Assistant: …"), followed by the new user message. Nothing user-provided is put in the arguments.
   - The working folder is a fresh temp folder, deleted afterwards.
3. **Environment.** The backend's environment minus `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`, so an API key from elsewhere is never billed by mistake. Then `CLAUDE_CODE_OAUTH_TOKEN=<saved token>` is added when the configuration has one. An optional config value `claude_config_dir`, a local path checked to exist, sets `CLAUDE_CONFIG_DIR` for machines with several Claude Code profiles.
4. **MCP server.** `python -m app.agent.mcp_server`, run with the backend's own interpreter (`sys.executable`) and `PYTHONPATH` set to the backend folder. It speaks stdio JSON-RPC 2.0 (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`) and needs no new dependency.
   - It opens its own database session from the same `LH_DATABASE_URL` and serves exactly `AgentTools` (`specs()` and `run()`), so all tool rules hold.
   - Only the variables it needs are passed to it: database URL, roadmap folder, storage folder. The token is never passed.
   - Tool names reach Claude Code as `mcp__learninghub__<tool>`; the adapter strips the prefix for the trace.
5. **Reading the stream.** Each stdout line is JSON.
   - Tool calls come from `assistant` messages' `tool_use` blocks, and their results from `user` messages' `tool_result` blocks.
   - `ToolOutcome.summary` and `changed_lesson` cannot cross the process boundary. The MCP server therefore puts a one-line summary and, when a lesson was written, a `changed_lesson` value in the tool result's `_meta`. If the CLI drops `_meta`, use a trailing marker line that the adapter removes before the text reaches the model's trace.
   - The final text comes from the `result` message. `is_error` and the `subtype` are mapped to categories, and so are the error texts: not logged in or invalid token → `auth_failed`; usage limit or rate limit → `rate_limited`.
   - stderr is read but never logged with prompt text.
6. **Limits.** The timeout is enforced with a deadline (kill the process tree on Windows, `taskkill /T /F` or `proc.kill()`); the error is `timeout`. When the step limit is passed (counted from `tool_use` blocks), the process is stopped and the result is `stopped=True` with the trace so far, as in `run_agent`.
7. **Type entry.** `claude-code`: label "Claude Code (subscription)", `needs_key=False`, `needs_base_url=False`, base URL refused, supported parameters `timeout` only, catalog models `sonnet`, `opus`, `haiku`. A saved key must be a setup token (`sk-ant-oat…`, normalized as before); anything else is refused, naming the key field ("only a Claude setup token can be used here").
8. **Test Connection.** It runs the same command with no MCP config (`--tools ""` and no tools allowed) and the one-word test prompt. `list_models` returns the catalog list.
9. **Frontend.** A type card "Claude Code (subscription)" with the hint "Uses Claude Code on this machine. Optional: a token from `claude setup-token`." For this type the base URL field and the sampling parameters are hidden, and the key field is labelled "Setup token (optional)".

## Risks / Trade-offs

- **Slower.** Each request starts a CLI process (seconds). This is accepted; the answer caption already shows which provider answered.
- **CLI output may change between versions.** The parser ignores unknown message types, and unit tests pin the stream fixtures recorded from 2.1.302.
- **Subscription usage.** Every chat uses the owner's limits, shared with their own Claude Code sessions. `rate_limited` triggers the fallback.
- **Prompt injection through notes.** It is the same exposure as today. The tools are the only capability, so an injected instruction can at most call the app's own tools, which cannot delete or overwrite user lessons.
