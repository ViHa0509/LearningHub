# Tasks

## 1. Backend (spec: claude-code-provider, ai-providers)

- [x] 1.1 Add the `claude-code` type (params, catalog, validation: no base URL, timeout only, key must be a setup token) and verify pytest cases for the three new ai-providers scenarios
- [x] 1.2 Add the stdio MCP server `app.agent.mcp_server` serving `AgentTools` (initialize, tools/list, tools/call, ping; summary and changed lesson in the result), and verify pytest cases that drive it over pipes, including the user-written-lesson refusal and untrusted note wrapping
- [x] 1.3 Add `ClaudeCodeAgent` (command, isolated temp folder, environment with token only in env, stream-json parsing, step limit, timeout, error categories) with an injected process runner, and verify pytest cases using recorded stream fixtures for every claude-code-provider scenario
- [x] 1.4 Route `run_agent`, the factory, `resolve.py` fallback and Test Connection through the new agent for this type, and verify chat API tests (answer with trace, lesson written, rate_limited triggers fallback, CLI not found)
- [x] 1.5 Run the real CLI once by hand on this machine with a harmless prompt to check the flags and stream shape (no test calls it), and record the result in `evidence.md`

## 2. Frontend (spec: ai-providers)

- [x] 2.1 Add the type card, help text, hidden base URL and sampling fields, and the "Setup token (optional)" key label for `claude-code`, and verify Vitest tests

## 3. E2E and verification

- [x] 3.1 Add a fake `claude` executable for e2e (`LH_CLAUDE_BIN`, emits stream-json for scripted models), run qc-e2e on this change and loop dev fixes until the suite passes
- [x] 3.2 Run every CLAUDE.md check and the verifier, record the results in `evidence.md`, and verify the verdict is pass
