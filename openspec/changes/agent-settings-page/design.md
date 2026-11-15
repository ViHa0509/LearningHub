# Design

## Data

Migration `0019_area_agent_settings.py` (down `0018`): table `area_agent_settings`

| column | type | notes |
|---|---|---|
| `user_id` | uuid, PK, FK `users.id` ON DELETE CASCADE | `user_fk(primary_key=True)` |
| `domain_id` | text, PK | a built-in roadmap id (`backend`) or an area slug (`o-to-hang-b`) |
| `instructions` | text, not null, default `''` | at most 4000 characters |
| `tools` | json, nullable | list of tool names the agents may use on this area; `null` = every tool |
| `updated_at` | timestamptz, server default now(), onupdate | |

RLS on the table as on every public table (`alembic/env.py`). Model `AreaAgentSetting` in `db.py`. No row = defaults (no instructions, all tools). A PUT with empty instructions and `tools: null` deletes the row.

## API (`routes/agents.py`, all under a session; PUT needs `X-LearningHub: 1`)

- `GET /api/agents/tools` → `[{ name, description, agents: ["assistant", ...] }]`: the app tools from `tools.py` (`SPECS` for every agent, `ASSISTANT_SPECS` for `assistant`, `OUTLINE_SPECS` for `outline`), `description` = the spec's first sentence. Order as in the specs.
- `GET /api/agents/areas` → `[{ domain_id, title, field_title, editable, instructions, tools }]` for every domain of the user's catalog (`catalog.domains()` order). `tools` is `null` for "all". Rows for domains no longer in the catalog are not listed (they stay in the table).
- `PUT /api/agents/areas/{domain_id}` body `{ instructions: str, tools: list[str] | null }` → the same object. 404 for a domain not in the user's catalog. 422 when `instructions` is longer than 4000 characters or `tools` names an unknown tool (validated against the names of `GET /api/agents/tools`). `tools` is stored sorted and unique; an empty list is allowed (no tool). Empty instructions and `null` tools delete the row.

## Applying the settings (`routes/agent.py`, `agent/loop.py`, `agent/tools.py`)

- `area_of_page(session, user, page) -> str | None`: `roadmap`/`lesson` → `page.domain`; `note` → the domain of the note's `node_id` when the note is the user's, linked and the node exists; `home` → `None`.
- `routes/agent.py` loads the row `AreaAgentSetting(user_id, domain_id)` for that domain (none → defaults) and passes `area_instructions: str` and `allowed_tools: set[str] | None` to `run_agent`; `AgentTools(..., allowed=allowed_tools)`.
- `loop.py` `system_prompt(...)` gains an `area_instructions` argument: when non-empty, a block after the agent's role:

  ```
  Instructions of the user for this area (follow them unless they conflict with the rules above):
  <instructions>
  ```

  The user's own instructions are trusted text (not wrapped as untrusted). They never override the lesson-protection and note-as-data rules above them in the prompt.
- `AgentTools.specs()` returns only the specs whose name is in `allowed` (when `allowed` is not `None`); `run()` refuses a tool outside the allowed set with the same error as an agent-only tool ("tool not available for this agent"). The model never sees the refused tools, so this is a guard only.
- Claude Code path: `claude_code.py` sets `env["LH_AGENT_TOOLS"]` to the comma-separated allowed names (unset = all); `mcp_server.py` `tools_list()` lists only the allowed names and `run_tool` builds `AgentTools(..., allowed=...)` from that variable. The area instructions reach Claude Code through the system prompt as today.
- `web_search` stays per agent (unchanged).

## Backup and restore (`data_sync/backup.py`, `restore.py`)

`data/area_agent_settings.json`: rows `{ domain_id, instructions, tools, updated_at }` of the user; restore replaces the user's rows after validation (domain ids are strings; `tools` a list of strings or null); an archive from before this change restores with no rows. Counts: `area_agent_settings` added to the counts dictionary the restore and sync endpoints return.

## Frontend

- Route `{ page: 'agents-settings' }` ↔ `#/settings/agents` (`route.ts`: parse, hash, `isSettings`). `SettingsNav`: tab `agents`, label "Agents", `#/settings/agents`, after "AI providers", for every member.
- `AgentsSettings.tsx` (new page): `<SettingsNav current="agents" />`, heading "Agents", then the existing agent cards (`AgentsSection` and `AgentCard` move from `SettingsPage.tsx` into this file unchanged in behaviour; the providers page keeps only the providers list and its heading), then a section `aria-label="Areas"` with heading "Areas" and one card per domain from `GET /api/agents/areas`, titled with the domain title and the field title as a muted suffix (e.g. "Ô tô hạng B · Lái xe"); inside: textarea "Extra instructions for <title>" (4000 max, a counter when above 3500), a fieldset "Tools for <title>" with one checkbox per tool from `GET /api/agents/tools` (label = name in code font + description; a tool that only one agent has says "Learning assistant only" / "Topic outline only"), buttons "Save" (primary, disabled until the card differs from the saved value) and "Cancel"; a "Saved" line for 2 s. All tools ticked ↔ `tools: null` in the request; otherwise the ticked names.
- `api.ts`: `AgentTool`, `AreaAgentSettings`, `api.agentTools`, `api.areaAgents`, `api.saveAreaAgents(domain, body)`; `queryKeys.agentTools`, `queryKeys.areaAgents`.
- `fakeApi.ts`: the three routes with validation like the backend (`state.areaAgents`).
- CSS: `.area-agent-card` (border, padding), the tool list in two columns at ≥ 640 px.
- `AppShell.tsx` renders `AgentsSettings` for the route; `backFromSettings` unchanged.

## Tests

- Backend: `test_area_agent_settings.py` (tools catalog; areas list with defaults; PUT stores, sorts, validates, 404 on a foreign area, deletes on defaults; another user sees nothing); `test_agent_chat.py` (fake model sees the instructions block on a lesson page of the area and not on home; a note linked to the area's topic; tools not allowed are absent from the specs the model gets and refused if called); `test_data_backup*.py` round trip; migration test for 0019.
- Vitest: `AgentsSettings.test.tsx` (cards, Save disabled until a change, Cancel, "all tools" ↔ null, 4000 limit message); `SettingsPage.test.tsx` no longer expects the agent cards; `SettingsNav` test for the tab.
- E2E: `agents-settings.e2e.ts` from the spec scenarios; `providers.e2e.ts` agent-card tests navigate to `#/settings/agents`.
