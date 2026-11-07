## Why

The owner wants the agent to run on their Claude subscription. Calling the Messages API directly with a subscription token (`claude setup-token`) is answered with 429: Anthropic serves subscription tokens through its own apps. The supported way to use a subscription from another program is to run Claude Code itself in non-interactive mode (`claude -p`), which is also what `claude setup-token` is meant for.

## What Changes

- New provider type **Claude Code (subscription)**, `claude-code`. It runs the installed `claude` CLI for each chat request instead of calling an HTTP API. It needs no base URL and no key. It uses the machine's Claude Code login, or an optional setup token stored encrypted like any key and handed to the CLI as `CLAUDE_CODE_OAUTH_TOKEN`.
- The agent's tools (search notes, read a note, list a roadmap, read a lesson, write a lesson) reach Claude Code through a local MCP server that Learning Hub starts for the call. They are the same tool implementations with the same rules: notes stay inside `<untrusted_note_content>`, nothing is deleted, and user-written lessons are never overwritten. Every built-in Claude Code tool is switched off: no shell, no file access, no web.
- The Claude Code run is isolated: an empty working folder, no user or project settings, hooks, plugins, CLAUDE.md or other MCP servers, no saved session, and the app's system prompt.
- The answer shows the same tool trace and changed lessons as other providers. The step limit and the timeout apply, and the process is stopped when either is reached.
- Test Connection runs one short prompt and reports `invalid_config` if `claude` is not installed, `auth_failed` if it is not signed in, `rate_limited` if a usage limit is reached, and `timeout`, `unavailable` or `ok` otherwise.
- Model: `sonnet`, `opus`, `haiku` or a full model id, passed to `--model`. Sampling parameters are not offered for this type; only the timeout is.

## Capabilities

### New Capabilities

- `claude-code-provider`: running the agent through the Claude Code CLI on the user's subscription.

### Modified Capabilities

- `ai-providers`: the list of types gains `claude-code`; validation and supported parameters for it.

## Impact

- Backend: a new adapter that runs the agent through the CLI, a stdio MCP server module for the agent tools, a type entry in `llm/params.py` and the model catalog, a factory branch, and the chat route using the CLI path for this type.
- Frontend: a type card, help text, and fields shown for this type (model, optional setup token, timeout).
- Tests: the CLI is injected and faked. A fake `claude` executable is used for e2e, set with `LH_CLAUDE_BIN`. No test runs the real CLI.
- No migration.
