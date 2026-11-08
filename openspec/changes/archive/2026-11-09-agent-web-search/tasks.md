## 1. Backend

- [x] 1.1 `agent_settings` table and migration `0009` (after `0008_news_items`); `GET /api/agents` returns `web_search`; `PUT /api/agents/{id}/settings` with the header guard
- [x] 1.2 Pass the setting to the Claude Code run: argv with `--tools WebSearch` and `--allowedTools WebSearch,mcp__learninghub__*` only when on; step summary "Searched the web for '<query>'"; safety text and Sources instruction
- [x] 1.3 Tests: off by default (no built-in tools), on (argv, trace), header guard; fakes emit a WebSearch tool use

## 2. Frontend

- [x] 2.1 Settings → Agents: Internet search switch saved with the card's Save; note for non-Claude-Code providers; Vitest

## 3. E2E

- [x] 3.1 qc-e2e with the fake `claude`: enable, search shows in the trace; off by default; other provider note; loop until the suite passes
