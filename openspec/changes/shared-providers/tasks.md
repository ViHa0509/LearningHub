# Tasks

## 1. Backend

- [x] 1.1 Migration `0021` and models: `ai_providers.shared`, table `shared_usage`; `Settings.shared_daily_limit` (main session; check: `cd backend && .venv/Scripts/python -m pytest tests/test_migrations_shared.py`)
- [x] 1.2 Sharing on the provider routes: admin only, never Claude Code, hidden from other users, not in backup or restore; tests for every scenario of `specs/ai-providers/spec.md` (check: backend tests, lint, types)
- [x] 1.3 Shared mode and the daily limit: admin's setup in `resolve` (primary, fallback, Internet search), one atomic count per agent request, 429 over the limit, `GET /api/agents` reference, usage and `shared_withdrawn` for shared mode; tests for every scenario of `specs/agent-providers/spec.md`, including two requests at once at the limit (check: backend tests, lint, types)

## 2. Frontend

- [x] 2.1 Provider form and list (admin): the switch and the Shared badge; shared-mode views: the "shared by the admin" line and the count in Settings -> Agents and on the providers page, no "add a provider" hint in the chat, the limit message in the chat, read-only agent rows, the withdrawn warning; Vitest for each (check: frontend tests, lint, build)

## 3. Quality

- [x] 3.1 `qc-e2e`: Playwright tests from both spec files with an admin and a member, light and dark screenshots; full e2e passes (check: `cd frontend && npm run e2e`)
- [x] 3.2 `verifier` report for the change: pass
