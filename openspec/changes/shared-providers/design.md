# Design

## Context

- `ai_providers`, `agent_providers` and `agent_settings` are per user; every query filters by `user_id` (`app/routes/ai_providers.py`, `app/agent/resolve.py`).
- `resolve.effective()` picks: the agent's active primary, else the assistant's (inherited), else `first_active()`, else none -> `ResolveError(409, NO_PROVIDER)`. `resolve_chain()` builds the `AgentModel` (primary and fallback) with the owner's key through `settings_of(row, box)`. `web_search_enabled()` reads the user's `agent_settings` row.
- `usable()` already refuses a Claude Code configuration that is not the admin's.
- `agent_providers.provider_id` is `ON DELETE RESTRICT`. This design never lets another user's assignment point at a shared row, so the owner's edit, switch-off and delete stay as they are.
- The app has one admin (`users.role = 'admin'`).

## Decisions

1. **Schema** (migration `0021`, RLS through `alembic/env.py`):
   - `ai_providers.shared boolean not null default false`.
   - `shared_usage (user_id FK users cascade, day date, runs integer not null, PK (user_id, day))`.
2. **Who may share.** `shared` is accepted only from the admin; from a member a body with `shared: true` answers 403 and stores nothing. `shared: true` on type `claude-code` answers 422 (the CLI runs with the admin's subscription and is admin-only).
3. **Shared mode.** A user is in shared mode when they have no usable active configuration of their own. Then, for agent A, the rows are taken from the admin's setup, keeping only rows that are `shared`, active and not `claude-code`:
   - primary: the admin's primary for A; else (A has no assignment of the admin's) the admin's assistant primary; else the first shared active row by `created_at, name`;
   - fallback: the admin's fallback for A (or the assistant's, when inherited), when it is a different row;
   - Internet search: the admin's `agent_settings.web_search` for A.
   Reason reported: `"shared"`. No shared active row -> `ResolveError(409, NO_PROVIDER)` as today. A provider override in a request still matches only the user's own rows (another id is 404). Per-area tool settings stay the user's own.
4. **The admin.** For the admin the shared rows are their own rows: normal resolution, never counted, no limit of any kind.
5. **Limit.** `Settings.shared_daily_limit` (`LH_SHARED_DAILY_LIMIT`, default 10, at least 1). One count per agent request in shared mode (a chat message, a lesson draft, every route that calls `resolve_chain`), whatever the number of model or tool calls inside it. The count is taken before the model is called, in one statement: `INSERT INTO shared_usage ... VALUES (:user, :day, 1) ON CONFLICT (user_id, day) DO UPDATE SET runs = shared_usage.runs + 1 WHERE shared_usage.runs < :limit RETURNING runs`; no row back means over the limit -> 429 `Daily limit reached: you have used today's 10 requests on the shared provider. Add your own provider in Settings, or try again tomorrow.` The answer also carries `resets_at` (the next 00:00 UTC as an ISO instant); the chat shows it after the message in the user's time zone (change `user-timezone`; the browser's zone until that is built). The day is the UTC date. A request that later fails still counts (simple, and it stops retry loops from spending the key). Display-only calls (`effective()` for Settings, model lists) do not count.
6. **What other users see.** `GET /api/ai-providers` is unchanged (own rows only). `GET /api/agents` reports each agent's effective provider as today; in shared mode the reference holds only `name` and `model`, plus `shared: true`, and the answer carries `shared_usage: {used_today, daily_limit}` for the asking user. No key hint, base URL, parameters, owner email or test result. Test-connection, model list, update and delete on a shared row by another user answer 404, as for any foreign id.
7. **Withdrawn warning.** No new table. `GET /api/agents` carries `shared_withdrawn: true` when the user has no usable active configuration of their own, no shared active configuration exists, and the user has a `shared_usage` row in the last 30 days. The page then shows a warning icon with the text `The shared provider is no longer available. Add your own provider to keep using the agents.` and a link to the providers page. It disappears when the user adds a configuration, when a configuration is shared again, or 30 days after their last shared request. A user who has configurations of their own never sees it: their own are used, as before.
8. **Logs.** The existing LLM log records already carry `provider_id` and no text. A refused request logs `user_id` and `"shared limit"`; never the prompt.
9. **Backup and restore.** The archive does not carry `shared` or `shared_usage`. A restored configuration is private.
10. **UI.**
    - Provider form, admin only, not for Claude Code: checkbox **Shared with all users** with the line "Other users can run the agents on this key without adding their own (10 requests a day each)." (the number comes from the server). It follows the Save rule of the form. The list shows a **Shared** badge.
    - A user in shared mode: Settings -> Agents shows per agent "Uses <name> (<model>), shared by the admin" and once "<used> of <limit> requests used today"; the providers page shows the same line above the empty list; the chat shows no "add a provider" hint.
    - Over the limit: the chat shows the 429 message as its error line.
    - Withdrawn: the warning icon and text of decision 7 in Settings -> Agents, above the list on the providers page, and in the chat's "no provider" hint.
    - The shared setup is read-only for the user: the agent rows show the provider and the Internet search state without controls until the user has a configuration of their own. `PUT` of an agent's Internet search by a user in shared mode is stored but has no effect while they are in shared mode.

## Risks

- Cost: open sign-up plus a shared key lets strangers spend it, 10 requests a day each; many accounts multiply that. Mitigation: admin-only sharing, the limit, and the admin can unshare or switch the configuration off at once. A cap across all users is not in this change.
- A member's conversation text goes to the provider under the admin's key; the admin does not see it in the app, and nothing new is logged.
- Counting by requests, not tokens: one long request costs more than a short one. Accepted for a first version.
- The admin's Internet search switch applies to shared-mode users, so their searches are also paid by the admin's key.

## API contract (added 2026-11-19; binding for backend, frontend and e2e)

It replaces the `GET /api/agents` wording of decisions 6 and 7 where they differ: `GET /api/agents` stays a list.

- **Provider routes** (`/api/ai-providers`): `ProviderOut` gains `shared: bool`. The create and update bodies accept `shared: bool` (optional; default false on create, unchanged when left out on update). A member sending `shared: true` -> 403 `only the admin can share a provider`. `shared: true` with type `claude-code` -> 422 `Claude Code cannot be shared`. Changing a shared row's type to `claude-code` is refused the same way.
- **`GET /api/agents`** (list of `AgentOut`): `effective_reason` gains the value `"shared"`. `ProviderRef` gains `shared: bool` (false for the user's own rows). For a user in shared mode each agent has `primary: null`, `fallback: null`, `effective` = the shared row that agent would run on with `shared: true` and `last_test_status: null`, and `web_search` = the admin's switch for that agent.
- **`GET /api/agents/shared`** (session) -> 200 `{"mode": "own" | "shared" | "none", "used_today": int, "daily_limit": int, "resets_at": str, "withdrawn": bool}`.
  - `mode`: `own` when the user has a usable active configuration of their own (always for the admin who has one); `shared` when in shared mode with a shared row available; `none` otherwise.
  - `used_today` is the user's count for the current UTC day (0 without a row); `daily_limit` is the server setting; `resets_at` is the next 00:00 UTC as an ISO-8601 instant.
  - `withdrawn` is true only with `mode: "none"` and a `shared_usage` row of the user in the last 30 days.
- **Over the limit**: every route that runs an agent answers 429 `{"detail": "Daily limit reached: you have used today's <N> requests on the shared provider. Add your own provider in Settings, or try again tomorrow."}` before any model call (for a streaming chat route: as the HTTP status, before the stream starts). The page reads `resets_at` from `GET /api/agents/shared`.
- **Shared mode and settings routes**: `PUT` of an agent's assignment with the shared row's id answers 404 (`unknown provider`, as for any foreign id). `PUT` of an agent's Internet search stores the user's own switch as today; it has no effect while the user is in shared mode.
