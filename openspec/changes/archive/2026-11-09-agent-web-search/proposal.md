## Why

The user wants the agent to look things up on the internet when their notes and lessons do not cover a question, for example recent AI news or a library's current API.

## What Changes

- **A switch per agent:** each agent gets an "Internet search" switch in Settings → Agents.
  - It is off by default and saved explicitly with the agent card's Save button.
  - It is stored in a new table `agent_settings` (Alembic `0009`) and returned by `GET /api/agents`. It is changed with `PUT /api/agents/{id}/settings {web_search}` (`X-LearningHub: 1`).
- **Claude Code providers:** when the switch is on and the agent's resolved provider is a Claude Code configuration, the CLI runs with `--tools WebSearch` and `--allowedTools "WebSearch,mcp__learninghub__*"`.
  - WebSearch runs on Anthropic's side and returns only titles and URLs; it does not load pages on the user's machine.
  - WebFetch and every other built-in tool stay off.
  - The search appears in the tool trace as "Searched the web for '<query>'", and the system prompt tells the agent to list the URLs it used under "Sources".
- **Other provider types:** the switch shows "Internet search needs a Claude Code provider" and has no effect for this agent's current provider.
  - Anthropic API web search is a follow-up change: its encrypted result blocks must be sent back exactly as received across the tool loop.
- Search results are untrusted text. The safety paragraph covers web search results like note content.
- Tests never call the real CLI: the fake `claude` (`frontend/e2e/fake_claude.py`, and the backend fakes) learns to emit a WebSearch `tool_use` and `tool_result`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `agent-providers`: new requirement "Internet search per agent".

## Impact

- Backend:
  - `app/db.py` + migration `0009_agent_settings`
  - `app/routes/agents.py`
  - `app/agent/resolve.py` / `app/agent/llm/claude_code.py` (pass the flag; argv; step summary)
  - `app/agent/loop.py` (safety text and Sources instruction when on)
  - tests and fakes
- Frontend: Settings → Agents switch with Save, `api.ts`, the fake API, Vitest.
- E2E: turn it on, the fake CLI's search shows in the trace; off by default; a non-Claude-Code provider shows the note.
