# Tasks

Contract: `design.md` and `specs/agent-chat/spec.md`.

## 1. Backend

- [x] 1.1 Migration 0024 (main session): table `agent_runs`, RLS on (design 2). Verify: `alembic upgrade head` and downgrade on the test DB; a migration test like `test_migrations_a2ui.py`.
- [x] 1.2 `run_id` in `ChatIn`, the run row inserted before the loop and removed after, stale rows of the user removed, 409 on a run id in use; `POST /api/agent/runs/{run_id}/stop` answering 204 for own, unknown, ended and other users' runs. Verify: pytest covers each case, including that another user's stop leaves the run going (`test_isolation_*` style).
- [x] 1.3 Stop signal in `tool_loop` before each model call and each tool call; a cancelled run returns its steps with "Stopped by you." and is stored with `stopped`. Verify: pytest with an injected fake model: stop during the first of two tool calls runs only that call and makes no further model call; the stored message and `ChatOut` have `stopped` and the reply "Stopped by you.".
- [x] 1.4 Claude Code runner and the nested A2UI tutor honour the signal (design 3). Verify: pytest with the fake runner shows the process tree kill path taken and no surface stored by a stopped tutor.

## 2. Frontend

- [x] 2.1 `useAgentChat`: a run id per send, `stop()`, `stopping` state. Verify: Vitest for stop while busy and the request body (`run_id`), and that a second Stop press sends nothing.
- [x] 2.2 Composer shows Stop (then "Stopping…", disabled) while busy; every answer with `stopped` (live or from History) shows a Stopped mark; Retry works on it. Verify: Vitest for Composer and MessageList; `npm run lint`, `npm run build`.

## 3. E2E and verification

- [x] 3.1 qc-e2e: fake LLM trigger that answers slowly with a tool call; in `agent-chat.e2e.ts`: stop a slow answer, stopped turn in History, Retry on it; screenshots light and dark. Verify: `npm run e2e` passes.
- [x] 3.2 qc-ui inspects the new screenshots. Verify: no open defect, or each is listed in `evidence.md`.
- [x] 3.3 Every check in `CLAUDE.md` passes and `openspec validate agent-stop --strict` passes. Verify: verifier report in `verifier-report.md`.

## Workflow follow-up

- Commit and push to `main` when everything is okay, then archive the change.
- Next change idea: approval before writing tool calls (approve or deny), on top of the same run row.
