# Proposal: agent-settings-tab (umbrella; the work is split into changes)

## Why

The owner asked (2026-11-15) for a Settings tab **Agents** to configure, per user, which agent and which tools serve each learning area, to connect MCP servers and to plug tools into the agents.

## Owner decisions (2026-11-16)

- Tools per area: the app's own tools and, later, tools from MCP servers.
- MCP servers: remote HTTP/SSE only on the hosted app (Vercel cannot start local commands). See the note on stdio servers below.
- Only the admin adds MCP servers; members pick from them per area.
- The Agents page ships now as its own Settings page; it folds into the tabbed Settings when `settings-tabs` ships.

## Owner direction (2026-11-16, later the same day)

- **Orchestrator**: the Learning assistant acts as an orchestrator. On a question it picks the specialist agents whose configured expertise (learning area) matches, delegates to them, and composes the answer. Specialist agents are configured per area (instructions, tools, provider).
- **Memory**: agents should read memory from a knowledge store. Two routes the owner wants to study: (a) the app's own vector embeddings over notes and lessons; (b) an MCP connection to Knowledge Hub (KH) so knowledge saved there is the agents' memory. KH hosted MCP: `C:\Users\Petrus\.claude-vio\kh-helper\Scripts\python.exe -m kh_helper.cli --kh-url https://knowledge-hub.cfapps.br10.hana.ondemand.com mcp`.
- Note on that command: `kh mcp` is a **stdio** server (checked 2026-11-16: `kh mcp --help` has no transport option) that uses the person's own `kh login` on that machine. It can serve a backend that runs on the owner's PC (`D:\Learning-hub`), not the Vercel copy. For the hosted copy the route to KH is KH's HTTP API with a token for the app (blocked on a KH admin registering a Keycloak client for Learning Hub, see HANDOFF.md) or the app's own embeddings.

## Changes

1. `agent-settings-page` — Settings → Agents page, agent cards moved there, per-area extra instructions and app-tool checklist, applied by the chat. **Active.**
2. `mcp-servers` — admin registers MCP servers: remote HTTP/SSE (usable everywhere) and, as a second transport, a local command (stdio) usable only when the backend runs on the owner's machine (the hosted copy shows such a server as unavailable); encrypted token or headers; their tools listed in the per-area checklist, run from the backend with a timeout; outputs are untrusted content. Not written yet.
3. `agent-orchestration` — specialist agents per area (name, instructions, tools, provider) and a `delegate` tool for the assistant that routes a question to the matching specialists and composes the answer; the trace shows each delegation. Not written yet.
4. `agent-memory` — the memory store behind the agents: KH over MCP (change 2) and/or the app's own embeddings over notes and lessons with a `recall` tool. To be decided after the owner's study.
5. `agent-plugins` — a bundle of instructions plus MCP servers switched on for an area in one click. Not written yet.

## Impact

- This change holds no specs or tasks; archive it when the changes above are shipped.
