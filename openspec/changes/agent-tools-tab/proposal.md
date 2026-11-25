## Why

Tools can be switched off only per area today (ticks in Settings > Agents > Areas). The owner asked (2026-11-24) for a **Tools** page under Agents in the Settings nav, where each agent has its own list of tools: add one from a dropdown, remove one that should not be attached.

## What Changes

- Settings nav: **Tools** as a child item under **Agents** (indented), at `#/settings/agents/tools`, for every member.
- The Tools page has one card per agent that uses tools: Learning assistant, Lesson writer, Topic outline, Interactive tutor. Each card lists the attached tools (name and short description) with a **Remove** button each, an **Add tool** dropdown with the agent's own tools that are not attached, and **Save** and **Cancel** for the card (nothing is saved before Save; leaving with unsaved changes asks first).
- The dropdown offers only the tools the agent was built for (owner's choice); by default every one is attached. A tool added to the app later is attached by default.
- Both layers apply: a tool is offered to the model only when the agent has it attached **and** the area's ticks allow it (owner's choice: the per-area ticks stay on the Agents page). A removed tool is refused when called, on every provider type (the Claude Code MCP server included).
- The Interactive tutor's output tool (the one that draws the quiz or lesson) is built in and not listed; it cannot be removed. The Note sorter has no tools and is not listed.
- The per-agent choice is the user's own data and is in the backup.
- Settings nav: **Connections** as a second child item under Agents, at `#/settings/agents/connections` (owner, 2026-11-24). It holds the external connections the agents use; today only the Knowledge Hub card, which moves there from the Agents page. The KH reconnect notification and the agent's "connect Knowledge Hub" message point to it.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `agent-settings`: Tools page and per-agent tool lists.

## Impact

- Backend: migration `0028` adds `agent_settings.disabled_tools` (JSON, null = none disabled; additive); `GET /api/agents/tools` also lists the Interactive tutor's read tools; `GET /api/agents/{id}/tools` and `PUT /api/agents/{id}/tools`; the chat route, the tutor and the MCP server combine the agent's and the area's tools; backup `AgentSettingRow.disabled_tools`.
- Frontend: `SettingsNav` child item, `AgentToolsSettings` page, route `#/settings/agents/tools`, `api.ts`.
- Tests: pytest, Vitest, e2e.
