# Tasks

Contract: `design.md`. Backend tasks 1.1 → 1.2 → 1.3 in order; frontend 2.1 can run beside 1.x against the fake API.

## 1. Backend

- [x] 1.1 Migration `0019_area_agent_settings.py` (table + RLS), model `AreaAgentSetting`, schemas, routes `GET /api/agents/tools`, `GET /api/agents/areas`, `PUT /api/agents/areas/{domain_id}` with validation (4000 chars, known tool names, 404 for a domain outside the catalog, delete on defaults); verify with new `tests/test_area_agent_settings.py` for every scenario of "Tools per area" (list and unknown name) and "Area settings are the user's own data" (another user's area), a 0019 migration test in the `tests/test_migrations_*.py` pattern, ruff, mypy
- [x] 1.2 Apply the settings: `area_of_page`, `run_agent(..., area_instructions, allowed_tools)`, `system_prompt` block, `AgentTools(allowed=...)` in `specs()` and `run()`, `LH_AGENT_TOOLS` in `claude_code.py` and `mcp_server.py`; verify with `tests/test_agent_chat.py` (fake model) for every scenario of "Extra instructions per area" (reach, stay, note linked) and "Tools per area" (off on the area, off on one area only), and the MCP server test file for the Claude Code scenario
- [x] 1.3 Backup and restore of `data/area_agent_settings.json` with counts; verify with `tests/test_data_backup*.py` ("Round trip", older archive)

## 2. Frontend

- [x] 2.1 Route `agents-settings` (`#/settings/agents`), `SettingsNav` tab, `AgentsSettings.tsx` with the agent cards moved from `SettingsPage.tsx` and the Areas section (instructions textarea with the 4000 limit, tools checklist, Save/Cancel per card), `api.ts`, `fakeApi.ts`; verify with Vitest for every scenario of "Agents page in Settings", "Save and Cancel", "Too long" (message), and all-ticked ↔ `tools: null`; `npm run lint`, `npm run build`

## 3. E2E and verification

- [x] 3.1 qc-e2e: `agents-settings.e2e.ts` from the spec scenarios (page, instructions reach the fake model on a lesson page of the area and not on home, tool off: the fake model's tool list lacks it, Save/Cancel, another member's area 404), move the agent-card tests of `providers.e2e.ts` to `#/settings/agents`, screenshots `agents-settings` light/dark/phone; `npm run e2e` passes
- [x] 3.2 Every check in `CLAUDE.md` passes, `openspec validate agent-settings-page --strict` passes; verifier report
