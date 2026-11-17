# Verifier report: pass

Change `kh-connector`, checked 2026-11-17 by `ai-sdlc-kit:verifier` on the uncommitted working tree. Every check passed on its first run; nothing was rerun. Task 4.1 is the owner's, outside the repo, and stays open.

## Checks

| Command | Exit | Result |
|---|---|---|
| `cd backend && .venv/Scripts/python -m pytest -rf -o addopts=""` | 0 | pass: 1152 passed in 13:31 |
| `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .` | 0 | pass: all checks passed, 182 files already formatted |
| `cd backend && .venv/Scripts/mypy app` | 0 | pass: no issues in 89 source files |
| `cd frontend && npm test` | 0 | pass: 39 files, 538 tests |
| `cd frontend && npm run lint` | 0 | pass: oxlint reported nothing |
| `cd frontend && npm run build` | 0 | pass: built (chunk-size warning only, not new) |
| `cd frontend && npm run e2e` | 0 | pass: 304 passed, 32 skipped, 15.7 min |
| `openspec validate kh-connector --strict` | 0 | pass: change is valid |

## Task evidence

| Task | Status | Evidence |
|---|---|---|
| 1.1 | evidence found | `backend/app/kh/service.py` (device flow with PKCE, rotation, revoke, `me`, `KhService`), `app/kh/http.py`, `app/routes/kh.py`, `alembic/versions/0020_kh_connections.py`, `KhConnection` in `app/db.py:146`, `app.state.kh` in `app/main.py`; `tests/test_kh_connector.py`, `tests/test_migrations_kh.py:12` |
| 1.2 | evidence found | `kh_search` in `app/agent/tools.py:510`, prompt line in `app/agent/loop.py:52`, `routes/agent.py:201`, `agent/mcp_server.py`, `routes/agents.py`, `claude_code.py`; `tests/test_kh_search.py`, `tests/test_kh_mcp.py` |
| 1.3 | evidence found | `app/data_sync/backup.py` and `restore.py` use explicit lists with no `kh` entry; `tests/test_data_backup_kh.py:66`, `:79`, `:91` |
| 2.1 | evidence found | `AgentsSettings.tsx`, `api.ts`, `test/fakeApi.ts`; `KhConnectorCard.test.tsx` (10 tests) |
| 3.1 | evidence found | `frontend/e2e/kh-connector.e2e.ts` (20 tests), `e2e/fake_llm.py` with `/kh-control`, `LH_KH_*` in `playwright.config.ts` |
| 3.2 | this report | every check passes |
| 4.1 | owner, open | outside the repo |

## Scenario to test

`specs/kh-connector/spec.md` (e2e lines are in `kh-connector.e2e.ts`, Vitest in `KhConnectorCard.test.tsx`):

| Scenario | Tests |
|---|---|
| Not configured | Vitest `:25`; pytest `test_kh_connector.py:160` |
| Routes when not configured | pytest `test_kh_connector.py:171`, `:178` |
| Connect | e2e `:186`; Vitest `:69`; pytest `test_kh_connector.py:201`, `:249` |
| Waiting | e2e `:238`; Vitest `:35`, `:49`; pytest `test_kh_connector.py:230` |
| Cancel while waiting | e2e `:254`; Vitest `:91`; pytest `test_kh_connector.py:454` |
| Sign-in refused | e2e `:269`, `:280`; Vitest `:103`; pytest `test_kh_connector.py:340`, `:350` |
| Code expired | e2e `:295`; Vitest `:121`; pytest `test_kh_connector.py:364`, `:372` |
| Checking too often | e2e `:305`; pytest `test_kh_connector.py:304` |
| Already connected | e2e `:320`; pytest `test_kh_connector.py:392` |
| Status holds no secret | e2e `:347`; pytest `test_kh_connector.py:469` |
| Another user | e2e `:390`; pytest `test_kh_connector.py:477`, `test_kh_search.py:226` |
| Backup | e2e `:371`; pytest `test_data_backup_kh.py:66` |
| Mutating calls need the app header | e2e `:329`; pytest `test_kh_connector.py:505` |
| Disconnect | e2e `:441`; Vitest `:160`; pytest `test_kh_connector.py:653` |
| Disconnect is confirmed first | e2e `:424`; Vitest `:173` |
| Sign-in ended elsewhere | e2e `:459`; pytest `test_kh_search.py:254` |
| Search | e2e `:473`; pytest `test_kh_search.py:82` |
| Result is untrusted | e2e `:499`; pytest `test_kh_search.py:110`, `:133` |
| Another project | e2e `:514`; pytest `test_kh_search.py:101` |
| KH refuses | e2e `:522`; pytest `test_kh_search.py:158` |
| KH does not answer | pytest `test_kh_search.py:168`, `:176` |
| Claude Code provider | pytest `test_kh_mcp.py:114`, `:148`, `:170` |

`specs/agent-settings/spec.md` (new scenarios):

| Scenario | Tests |
|---|---|
| List the tools with the Knowledge Hub connector | e2e `:534`; pytest `test_kh_search.py:273`, `:290` |
| Knowledge Hub search off on the area | e2e `:548`; pytest `test_kh_search.py:298` |

Uncovered scenarios: none. Deviations from design.md: none; each "Decided while building" item has a test (`test_kh_connector.py:443`, `:559`, `:575`, `:598`; `test_kh_search.py:141`, `:124`).

## Security checks

1. No route or tool result returns a token, device code or PKCE verifier: answers are `StatusView`, `PendingView`, `PollView` (`app/kh/service.py:75-94`); the tool result holds `project`, `truncated`, `text` (`app/agent/tools.py:536-543`). Tests `test_kh_connector.py:216`, `:238`, `:283`, `:469`; e2e `:347`.
2. Device code, verifier and refresh token go through `SecretBox.encrypt` (`service.py:250-251`, `:415`, `:523`); the table has no access-token column and `access_token()` returns without saving.
3. Log calls hold the call name, status and duration only (`service.py:171`, `:173`, `:454`); log-capture tests `test_kh_connector.py:522`, `test_kh_search.py:200`. The step text "Searched Knowledge Hub for '<query>'" is the chat trace shown to the user, not a log line.
4. Every read, update and delete of `kh_connections` is keyed on `user_id`, which comes only from `CurrentUser`, `search_for(user.id)` or `LH_AGENT_USER_ID`. Tests `test_kh_connector.py:477`, `test_kh_search.py:226`; e2e `:390`.
5. `connect`, `connect/poll` and `DELETE` need `X-LearningHub: 1` (`routes/kh.py:39`, `:52`, `:60`); the router is behind the app-wide session guard. Tests `test_kh_connector.py:505`, `:514`; e2e `:329`.
6. The KH client has no generic request method: `_send` is private and called only as `device`, `token`, `me`, `revoke`, `refresh`, `search`. `test_kh_search.py:315` asserts the fake KH received no write.
7. KH text reaches the model only inside `<untrusted_kh_content>`: closing tag neutralised case-insensitively (`tools.py:535`), project attribute escaped (`tools.py:540`), KH error text capped at 200 characters. Tests `test_kh_search.py:110`, `:133`, `:194`.
8. `kh_connections` is in neither backup nor restore (`test_data_backup_kh.py:66`, `:79`, `:91`; e2e `:371`).
9. RLS: `alembic/env.py` enables it on every public table after each upgrade; `test_migrations_kh.py:20-26` asserts it for `kh_connections`.
10. Tests use an injected fake HTTP function, a local 127.0.0.1 server (`test_kh_mcp.py`) or the e2e fakes on port 8002; no real identity service, KH or provider.

## Notes

- `verification_uri_complete` and `user_code` are returned to the page by design: they are the user's sign-in link and code.
- Known limit (design.md): the Claude Code MCP server is not given `LH_SECRET_KEY`; with that setup `kh_search` is offered but answers "connect again".
- Not verified here: task 4.1, including whether KH's API accepts tokens issued to a client other than `kh-cli`.
