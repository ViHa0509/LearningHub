# Change: Settings → Agents page with per-area instructions and tools

## Why

The owner asked (2026-11-15, point 5) for an Agents tab in Settings to configure, per user and per learning area, how the agents work and which tools they may use, with MCP connections and plugins later. Today the agent cards (provider assignment, Internet search) sit under the providers list, and every agent uses the same fixed instructions and tool set on every area. A driving-law area and a backend roadmap need different guidance ("answer in Vietnamese, cite the article of the law") and not every tool makes sense everywhere.

Owner decisions (2026-11-16): tools per area cover the app's own tools and, later, MCP tools; MCP servers are remote HTTP/SSE only and added by the admin only; the Agents page ships now as its own Settings page, not waiting for `settings-tabs`.

This is the first of three changes: `agent-settings-page` (this one), `mcp-servers`, `agent-plugins`.

## What changes

- A Settings page **Agents** at `#/settings/agents`, in the Settings nav for every member. The agent cards (primary, fallback, Internet search) move there from the AI providers page.
- An **Areas** section on that page: one card per domain the user can see (built-in roles and learning areas), with **Extra instructions** (free text the agents follow on that area's pages) and a **Tools** checklist (which of the app's tools the agents may use there; all on by default). Saved per area with Save and Cancel.
- The chat applies the area's settings when the current page belongs to that area (roadmap, lesson, or a note linked to one of its topics): the instructions are added to the system prompt, and tools not ticked are not offered to the model (API loop and the Claude Code MCP server alike).
- The area settings are the user's own data: in the backup archive, restored with it, removed with the user.

## Impact

- New capability spec `agent-settings`.
- Backend: migration `0019_area_agent_settings` (table `area_agent_settings`, RLS), `db.py`, `schemas.py`, `routes/agents.py` (`GET /api/agents/tools`, `GET /api/agents/areas`, `PUT /api/agents/areas/{domain_id}`), `routes/agent.py` + `agent/loop.py` + `agent/tools.py` (area instructions and allowed tools), `agent/llm/claude_code.py` + `agent/mcp_server.py` (`LH_AGENT_TOOLS`), `data_sync/backup.py` + `restore.py`.
- Frontend: route `agents-settings`, `SettingsNav` tab, new `AgentsSettings.tsx` (agent cards moved out of `SettingsPage.tsx`, Areas section), `api.ts`, `fakeApi.ts`, Vitest; e2e `providers.e2e.ts` (agent card tests move to the new page), new `agents-settings.e2e.ts`.
