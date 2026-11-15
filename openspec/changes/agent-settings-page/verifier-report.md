# Verifier report (2026-11-16, `ai-sdlc-kit:verifier`)

Verdict: **PASS**.

## Checks (one run for four changes: map-lesson-markers, chat-new-on-load, note-header-safe-edits, agent-settings-page)

| Command | Exit | Result |
|---|---|---|
| `cd backend && .venv/Scripts/python -m pytest` | 0 | 966 passed in 540 s |
| `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .` | 0 | All checks passed; 170 files already formatted |
| `cd backend && .venv/Scripts/mypy app` | 0 | no issues in 84 source files |
| `cd frontend && npm test` | 0 | 36 files, 496 tests passed |
| `cd frontend && npm run lint` | 0 | no problems |
| `cd frontend && npm run build` | 0 | tsc -b and vite build succeeded (chunk-size warning only) |
| `cd frontend && npm run e2e` | 0 | 266 passed, 30 skipped (viewport-only tests), 13.3 min |
| `openspec validate <change> --strict` (each of the four) | 0 | valid |

## Scenario -> tests

| Scenario | Test |
|---|---|
| Open the Agents page | `AgentsSettings.test.tsx` "has a route and a nav tab for every member", "shows the agent cards and one card per area"; `agents-settings.e2e.ts` |
| Providers page shows no agent cards | `SettingsPage.test.tsx`; e2e |
| Instructions reach the agent on the area | `test_agent_chat.py::test_area_instructions_reach_the_agent`; e2e with `[[echo-system]]` |
| Instructions stay on their area | `test_area_instructions_stay_on_their_area` (home and devops); e2e |
| Note linked to the area | `test_area_instructions_reach_the_agent_on_a_linked_note` |
| Too long | `test_instructions_over_4000_characters_are_refused`; `AgentsSettings.test.tsx` limit and server-message tests; e2e |
| Save and Cancel | `AgentsSettings.test.tsx`; e2e |
| List the tools | `test_tools_list_names_the_nine_tools_and_who_has_them` |
| Tool off on the area | `test_tool_off_on_the_area_is_not_offered_and_refused`; e2e with `[[echo-tools]]` |
| Tool off on one area only | `test_tool_off_on_one_area_only`; e2e |
| Claude Code provider | `test_claude_code.py::test_mcp_config_passes_the_allowed_tools`, `test_mcp_server_lists_only_the_allowed_tools` |
| Unknown tool name | `test_unknown_tool_is_refused_and_nothing_is_stored`; fake-API test |
| Another user's area | `test_another_users_private_area_answers_404_and_stays_unstored`; e2e |
| Round trip | `test_data_backup_area_agents.py` round trip, older archive, malformed file |

Deviations: the nav-tab test lives in `AgentsSettings.test.tsx` (no separate SettingsNav test). Security review (main session): the note lookup in `area_of_page` filters by the current user; area text is passed as a format value, so braces are harmless; an empty tool list means no tools on both the API loop and the MCP server; the MCP server still drops secret variables.
