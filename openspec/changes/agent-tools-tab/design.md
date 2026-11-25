## Context

- `agent_settings (user_id, agent_id, web_search)` holds per-agent switches; `area_agent_settings.tools` (null = all) holds the per-area ticks.
- The chat route passes `allowed` (area ticks) to `AgentTools`; `AgentTools.specs()` and `run()` filter and refuse by it; the Claude Code MCP server gets the same set (`app/agent/mcp_server.py`).
- `tool_catalog()` (`app/routes/agents.py`) lists each tool with the agents that have it; the tutor (`a2ui`) runs inside the assistant's tool call with `A2UI_READ_TOOLS` plus its built-in content tool, and today gets no area filter.

## Decisions

1. **Store the removed tools, not the attached ones.** `agent_settings.disabled_tools` JSON list, null or empty = all attached, so a tool added to the app later is attached by default. Migration 0028 is additive.

2. **Effective tools** for an agent on a page = its own tools (`tool_catalog` membership) minus `disabled_tools` minus what the area's ticks leave out. One helper computes it and the chat route uses it for the main agent and for the tutor; the same set goes to the MCP server. The tutor's content tool is never removable; the tutor runner adds it as today.

3. **API.** `GET /api/agents/{agent_id}/tools` -> `{"agent_id", "attached": [names], "available": [names]}` (available = own tools not attached, catalog order). `PUT /api/agents/{agent_id}/tools` `{"attached": [names]}` (header `X-LearningHub`): every name must be one of the agent's own tools, else 422 and nothing changes; stored as the complement in `disabled_tools`; an agent without tools (Note sorter) or an unknown id is 404. `GET /api/agents/tools` adds `a2ui` to the agents of `search_notes`, `read_note`, `read_lesson`, `list_roadmap`. `kh_search` keeps its availability rule.

4. **UI.** Nav item "Tools" rendered under "Agents" with an indent and `aria-current` like the others. One card per agent: the attached tools (name in code font, short description, Remove), a select "Add tool" with the available ones and an Add button, then Save (disabled until the draft differs from the saved list) and Cancel. With no tools attached the card says "No tools: this agent answers from the conversation only." The page notes that area ticks on the Agents page can still switch a tool off on one area. Leaving the page with an unsaved card asks first (the existing discard prompt).

5. **Connections.** Owner asked for a Connections tab without saying where; it is a child of Agents next to Tools, because the only connection (Knowledge Hub) exists for the agents' `kh_search` tool. The existing Knowledge Hub card component moves unchanged from `AgentsSettings` to a `ConnectionsSettings` page. The links change from `#/settings/agents` to `#/settings/agents/connections`: the `kh_reconnect` notification in `app/agent/tools.py`, and any KH sign-in return route. Old `kh_reconnect` rows keep their stored link (it still opens the Agents page); not migrated.

## Risks / Trade-offs

- [Removing `write_lesson` from the Lesson writer makes it useless] → allowed; the card shows each tool's description so the effect is clear, and the agent says it cannot save.
- [Two layers can confuse] → the note on the page (Decision 4).

## Migration Plan

One additive column. Rollback: drop the column.
