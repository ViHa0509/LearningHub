# Tasks

Contract: `design.md`. Backend tasks 1.1 -> 1.2 -> 1.3 in order (never two backend pytest runs at once); frontend 2.1 can run beside 1.x against the fake API.

`agent-settings-page` was archived on 2026-11-17, so the `agent-settings` spec this change modifies is in `openspec/specs/`.

## 1. Backend

- [ ] 1.1 Settings `kh_url`, `kh_issuer`, `kh_client_id`; migration `0020_kh_connections.py` (table + RLS) and model `KhConnection`; `app/kh/` with the device flow (PKCE), token refresh with rotation, revoke, `me`, and `KhService` on `app.state.kh` with an injectable HTTP function (design 1-6, 8); `routes/kh.py`: `GET /api/kh`, `POST /api/kh/connect`, `POST /api/kh/connect/poll`, `DELETE /api/kh`; verify with new `tests/test_kh_connector.py` (fake HTTP function) for every scenario of "The connector is off until the server is configured", "Connect with a device sign-in" (server side: connect, pending, refused, unknown account, expired, checking too often, already connected, cancel), "The KH sign-in is secret and the user's own" (status, another user, app header; a log capture holds no token) and "Disconnect" (revoke request sent, row gone), a 0020 migration test in the `tests/test_migrations_*.py` pattern, ruff, mypy
- [ ] 1.2 Agent tool `kh_search` (design 7): `ToolSpec`, `AgentTools(kh_search=...)` offered only when injected, untrusted wrapper with the closing tag stripped, errors as tool errors, the system prompt line, `routes/agent.py` and `agent/mcp_server.py` pass the user's search function, `GET /api/agents/tools` lists it when the connector is available; verify with `tests/test_agent_chat.py` (fake model, fake KH) for every scenario of "The agents search Knowledge Hub as the user" and "Sign-in ended elsewhere", the MCP server test file for the Claude Code scenario, and `tests/test_area_agent_settings.py` for the two new "Tools per area" scenarios
- [ ] 1.3 Backup and restore leave `kh_connections` out; verify with `tests/test_data_backup*.py` (scenario "Backup": a connected user's archive holds no KH connection data; restore of that archive works and keeps the connection row untouched)

## 2. Frontend

- [ ] 2.1 `AgentsSettings.tsx`: "Connections" section with the Knowledge Hub card and its five states (design 10), polling at the given interval and stopping on leave; `api.ts`, `fakeApi.ts`; verify with Vitest for "Not configured", "Connect", "Waiting", "Cancel while waiting", "Sign-in refused", "Code expired", "Disconnect", "Disconnect is confirmed first"; `npm run lint`, `npm run build`

## 3. E2E and verification

- [ ] 3.1 qc-e2e: fake identity service and fake KH on `frontend/e2e/fake_llm.py` with `/kh-control` (design 9), the `LH_KH_*` env in `playwright.config.ts`, new `kh-connector.e2e.ts` from the spec scenarios (connect through the fake sign-in, waiting state, refused, disconnect with confirm, the fake model is offered `kh_search` only when connected, a search answer reaches the chat inside the untrusted wrapper, `kh_search` unticked on an area), screenshots `kh-connector` light/dark; `npm run e2e` passes
- [ ] 3.2 Every check in `CLAUDE.md` passes, `openspec validate kh-connector --strict` passes; verifier report

## 4. Outside the repo (owner)

- [ ] 4.1 Ask a KH admin to register a Keycloak client for Learning Hub (public, device grant, `offline_access`, PKCE) and to confirm KH's API accepts its access tokens; set `LH_KH_URL`, `LH_KH_ISSUER`, `LH_KH_CLIENT_ID` on the hosted app; connect once and run one search
