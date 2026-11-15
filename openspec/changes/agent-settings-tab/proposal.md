# Proposal: agent-settings-tab (DRAFT, waiting for the owner's review)

## Why

The owner asked (2026-11-15) for a Settings tab **Agents** to configure, per user, which agent and which tools serve each learning area, to connect MCP servers and to plug tools into the agents. Today the agents are fixed in code (`agent/agents.py`: assistant, lesson writer, topic outline), each has a provider assignment and an Internet search switch, and the tool set per agent is fixed (`agent/tools.py`).

## What Changes (proposed slices, smallest first)

1. **Agents tab** (`#/settings/agents`): the agent list that lives on the providers page today (assignment, fallback, Internet search), moved to its own tab inside the tabbed Settings page of `settings-tabs`. No new behaviour.
2. **Per-area instructions and tools**: for each of the user's areas (and the built-in roles), optional extra instructions for the agents (e.g. "answer in Vietnamese, cite the law article") and a tool checklist (which of the app tools the assistant may use there); saved with Save/Cancel. The agent loop adds the area's instructions when the page is in that area.
3. **MCP servers**: a user can register an MCP server (URL or command; headers or token encrypted with the user's SecretBox); its tools are listed and can be switched on per agent and per area. Tools run from the backend with a timeout; their output is untrusted content (shown to the model inside a marked block like note text; never executed). Only HTTP/SSE servers on the hosted copy (no local commands there).
4. **Plugins**: a bundle of instructions plus MCP servers that can be switched on for an area in one click.

## Open questions for the owner

- Slice 2: is "tools per area" about the app's own tools (search notes, write lesson, web search...) or about outside tools (MCP) only?
- Slice 3: which MCP servers first? (Knowledge Hub is blocked on its own Keycloak client, see HANDOFF.md.) Remote HTTP servers only, or also local commands on the owner's PC?
- Who may add an MCP server: every member, or the admin only?
- Should slice 1 wait for `settings-tabs` (0 of 7 tasks done) or ship as a plain second page?

## Capabilities

### New Capabilities
- `agent-settings`: the Agents tab, per-area instructions and tools, MCP servers, plugins.

### Modified Capabilities
- `agent-providers`: the agent assignment UI moves to the Agents tab.
- `agent-chat`: the loop takes per-area instructions and MCP tools.

## Impact

- Not started: specs, design and tasks are written after the owner answers the questions above.
