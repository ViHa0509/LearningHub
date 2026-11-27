# Tasks

Contract: `design.md`. Backend 1.1 -> 1.2 in order (never two backend pytest runs at once); frontend 2.1 can run beside 1.x against the fake API.

## 1. Backend

- [x] 1.1 Settings `roadmapsh_api_base`, `roadmapsh_ref`; `app/roadmapsh/` with `RoadmapExplorer` (tree, outline, topic, 1 h cache, injectable HTTP function; design 1-2) on `app.state.roadmapsh` (`main.py`); tools `roadmapsh_list`, `roadmapsh_outline`, `roadmapsh_topic` in `ASSISTANT_SPECS` with handlers in `AgentTools` (design 3), wired in `routes/agent.py` and `agent/mcp_server.py`; prompt lines (design 4); for now the token argument is always `None`; verify with new `tests/test_roadmapsh_tools.py` (fake HTTP function) for every scenario of the first four requirements, ruff, mypy
- [x] 1.2 Migration `0029_github_tokens.py` (table + RLS) and model `GithubToken`; `routes/github.py` (`GET`/`PUT`/`DELETE /api/github`, design 5-6 and the API contract); the tools read the current user's token (design 3); verify with new `tests/test_github_token.py` for "An optional GitHub token per user" (server side: save, refused, 502, remove, another user, app header, status holds no token, a log capture holds no token, tools send the token / none, undecryptable token ignored, not in the backup), a 0029 migration test in the `tests/test_migrations_*.py` pattern, ruff, mypy

## 2. Frontend

- [x] 2.1 `ConnectionsSettings.tsx`: GitHub card (design 7) with Save/Cancel per the Save rule, Replace, Remove with confirm; `api.ts`, `test/fakeApi.ts`; verify with Vitest for "Save a token", "Token refused", "Remove is confirmed first", Save disabled until typed, Cancel clears; `npm run lint`, `npm run build`

## 3. E2E and verification

- [x] 3.1 qc-e2e: on `frontend/e2e/fake_llm.py` a fake roadmap.sh API under `/roadmapsh-api` (one synthetic roadmap), the tree fake also answering for ref `master` with that roadmap's synthetic content files, a fake `GET /github-api/rate_limit` (accepts one synthetic token, else 401); `LH_ROADMAPSH_API_BASE` in `playwright.config.ts`; new `roadmap-explorer.e2e.ts`: save, refused and remove of a token on Connections; the fake model calls the three tools and the answer reaches the chat; screenshots `roadmap-explorer` light/dark; `npm run e2e` passes
- [x] 3.2 Every check in `CLAUDE.md` passes, `openspec validate roadmap-explorer --strict` passes; verifier report
