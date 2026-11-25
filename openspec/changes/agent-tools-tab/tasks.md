# Tasks

Contract: `design.md` and `specs/agent-settings/spec.md`.

## 1. Backend

- [x] 1.1 (main session) Migration 0028: `agent_settings.disabled_tools` JSON null; model; backup `AgentSettingRow.disabled_tools` (optional). Verify: migration test up and down; backup round trip; an archive without it restores with none disabled.
- [x] 1.2 `GET/PUT /api/agents/{agent_id}/tools` and `a2ui` in `tool_catalog` (design 3). Verify: pytest (defaults, remove, add back, not-own tool 422, unknown agent and note-sorter 404, header required, isolation between users).
- [x] 1.3 Effective tools helper used by the chat route for the agent and the tutor, and by the MCP server (design 2). Verify: pytest per scenario of "A removed tool is not offered" (offered specs, refused call, both layers, Claude Code MCP list, tutor keeps its content tool).
- [x] 1.4 KH links point to `#/settings/agents/connections` (design 5): the `kh_reconnect` notification and any KH sign-in return route. Verify: pytest on the notification link.

## 2. Frontend

- [x] 2.1 `SettingsNav` child items Tools and Connections under Agents, routes `#/settings/agents/tools` and `#/settings/agents/connections`, `AgentToolsSettings` page with the cards (design 4), `api.ts`. Verify: Vitest per scenario of "Tools page under Agents" and "Add and remove an agent's tools"; `npm run lint`, `npm run build`.
- [x] 2.2 `ConnectionsSettings` page with the Knowledge Hub card moved from `AgentsSettings` (design 5); update the KH tests that expect it on the Agents page. Verify: Vitest per scenario of "Connections page under Agents"; lint, build.

## 3. E2E and verification

- [x] 3.1 qc-e2e: Tools (open from the nav, remove and save, add back, Cancel, dropdown offers only own tools, a removed tool is not offered in a chat if the fake LLM can show it) and Connections (KH card there and not on Agents); screenshots light, dark and phone. Verify: `npm run e2e` passes.
- [x] 3.2 qc-ui inspects the new screenshots. Verify: no open defect, or each listed in `evidence.md`.
- [x] 3.3 Every check in `CLAUDE.md` passes and `openspec validate agent-tools-tab --strict` passes. Verify: verifier report in `verifier-report.md`.
