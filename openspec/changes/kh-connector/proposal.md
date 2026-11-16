# Change: Knowledge Hub connector for the agents

## Why

The owner keeps most of what they learn in Knowledge Hub (KH) and asked (2026-11-16) how the Learning Hub agents can reach it. `docs/VISION.md` lists KH as an optional agent tool. Two routes were studied (`openspec/changes/agent-settings-tab/proposal.md`): KH's MCP server is stdio only and uses the `kh login` of one machine, so it cannot serve the hosted copy; KH's HTTP API with a sign-in made for this app works on both the hosted and the local copy, and each user reads KH as themselves.

This change builds that second route. It ships switched off: the connector appears only when the deployment has a KH URL, issuer and client id. The client id does not exist yet: a KH admin must register a Keycloak client for Learning Hub (public, device flow, `offline_access`). Until then the feature is built and tested against a fake identity service and a fake KH.

## What changes

- A **Knowledge Hub** card on Settings -> Agents, for every member: **Connect** starts a device sign-in (the card shows a link and a code, and waits), **Disconnect** ends it. Connected, the card says which KH account is linked.
- The sign-in is the user's own: the refresh token is stored encrypted per user, never returned by the API, never logged and never in the backup. Disconnect revokes it at the identity service.
- A new read-only agent tool **`kh_search`**: it asks KH for what the user may read about a query and returns KH's answer as untrusted content. It is offered only to a connected user, on every provider type, and it is in the per-area tools checklist.
- The tool never writes to KH.

## Impact

- New capability spec `kh-connector`; modified spec `agent-settings` (the tool list).
- Backend: settings `LH_KH_URL`, `LH_KH_ISSUER`, `LH_KH_CLIENT_ID`; migration `0020_kh_connections` (table `kh_connections`, RLS); new `app/kh/` (device flow, token refresh, search client); new `routes/kh.py` (`GET /api/kh`, `POST /api/kh/connect`, `POST /api/kh/connect/poll`, `DELETE /api/kh`); `agent/tools.py`, `agent/loop.py` (prompt), `routes/agent.py`, `routes/agents.py`, `agent/mcp_server.py`; `data_sync` (the table stays out of the archive).
- Frontend: `AgentsSettings.tsx` (new card), `api.ts`, `fakeApi.ts`, Vitest.
- E2E: fake identity service and fake KH on `frontend/e2e/fake_llm.py`, `playwright.config.ts` env, new `kh-connector.e2e.ts`.
- Outside the repo, by the owner: ask a KH admin for the Keycloak client and to confirm that KH's API accepts tokens issued to it; then set the three `LH_KH_*` variables on the hosted app.
