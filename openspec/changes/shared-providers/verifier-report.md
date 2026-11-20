# Verifier report: shared-providers

Verdict: **pass**, with two points for the owner to accept (below). 2026-11-20, `ai-sdlc-kit:verifier`; read-only, so the report is the only file written.

## Checks

| Command | Exit | Result |
|---|---|---|
| `cd backend && .venv/Scripts/python -m pytest` | not rerun by the verifier | run by the main session on this tree, after the last backend edit: `1219 passed in 1363.09s` |
| `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .` | 0 | pass ("All checks passed!", "191 files already formatted") |
| `cd backend && .venv/Scripts/mypy app` | 0 | pass ("Success: no issues found in 91 source files") |
| `cd frontend && npm test` | 0 | pass (46 files, 620 tests, first run, no rerun needed) |
| `cd frontend && npm run lint` | 0 | pass (oxlint, no output) |
| `cd frontend && npm run build` | 0 | pass (chunk-size warning only) |
| `cd frontend && npm run e2e` | not rerun by the verifier | run by the main session, not as one `npm run e2e` invocation but as five foreground batches covering all 34 e2e files once, after the last code edit: A 79 passed, B 64 passed, C 102 passed, D 60 passed, E 63 passed + 32 skipped; 0 failed |
| `openspec validate shared-providers --strict` | 0 | pass ("Change 'shared-providers' is valid") |

## Task evidence

| Task | Status | Evidence |
|---|---|---|
| 1.1 migration `0021`, models, setting | evidence found | `alembic/versions/0021_shared_providers.py` (`shared` default false, `shared_usage` PK (user_id, day), FK cascade; RLS comes from `alembic/env.py`), `SharedUsage` in `app/db.py`, `shared_daily_limit` (`ge=1`, default 10) in `app/config.py`; `tests/test_migrations_shared.py` |
| 1.2 sharing on the provider routes | evidence found | `check_sharing` in `routes/ai_providers.py` (403 member, 422 Claude Code, also on update to Claude Code); `ProviderOut.shared`; tests in `tests/test_shared_providers.py:125-272` |
| 1.3 shared mode, limit, `GET /api/agents`, `/api/agents/shared` | evidence found | `agent/resolve.py` (`shared_setup`, `in_shared_mode`, atomic `COUNT_SQL`, `take_shared_count` committed before any model is built, `_build` raises if uncounted), `routes/agent.py:183-187` (the only route that runs an agent calls `count`), `routes/agents.py` (`shared_ref`, `SharedStatusOut`); tests `:275-721` incl. two concurrent requests at the limit (`:566`, `:600`) |
| 2.1 frontend | evidence found | `SharedProvider.tsx`, `lib/shared.ts`, provider form switch; `SharedProviders.test.tsx` (18 tests) |
| 3.1 qc-e2e | unchecked; evidence now supports checking | `frontend/e2e/shared-providers.e2e.ts` (both spec files, admin and member); the batched e2e run passed (see Checks). Light and dark screenshots were not inspected by the verifier |
| 3.2 verifier report | this report | |

## Scenario to test map

| Scenario | Test |
|---|---|
| ai-providers: Admin shares / Member cannot share / Claude Code cannot be shared / Hidden from other users / Unshare / Backup | `test_shared_providers.py:129,159,182,218,251,262`; `SharedProviders.test.tsx:36-111`; e2e `:219,248,259,295,605` |
| agent-providers: Shared configuration for a user without one / Own wins / No shared / Switched off | `:279,314,327,339`; e2e `:306,363,379` |
| Agent follows the admin's assignment / Private assignment skipped / Internet search follows the admin | `:363,392,432`; e2e `:395` |
| Count shown / Over the limit / Another user / Next day / Admin is not counted | `:462,492,529,542,551`; `SharedProviders.test.tsx:115,172`; e2e `:448` |
| Withdrawn: Unshared / Switched off or deleted / Falls back to own / Shared again / Never used it | `:628,640,656,671,684`; `SharedProviders.test.tsx:213-261`; e2e `:493,562,587` |
| Read-only rows / Assigning the shared configuration is refused | `SharedProviders.test.tsx:115,139`; `test_shared_providers.py:704`; e2e `:306,428` |

Uncovered scenarios: none.

## Judgements asked for

1. **Read-only sharing, not copy.** Confirmed from the proposal: owner decision 8 says "A user sees the shared agent setup read-only", and "Not in this change" lists "Copying the admin's agent setup into a user's own settings". The phrase "read-only or copy" is not in the proposal text; copy is out of scope. The build is read-only sharing.
2. **What a member receives** (`routes/agents.py:89-99`, `shared_ref`; asserted in `test_shared_providers.py:296-306`): per agent in `GET /api/agents`, `effective` = `{id, name, provider_type, model_name, is_active: true, last_test_status: null, shared: true}`, with `primary: null` and `fallback: null`. So the member receives the admin's **real provider `id` and `provider_type`** in addition to name and model. No key, key hint, base URL, parameters, owner email or test result. `GET /api/agents/shared` carries no provider data. The chat answer carries `provider` (name and model of the row that answered).
   - Against the proposal (decision 4: "name and model only") and design decision 6 ("only `name` and `model`, plus `shared: true`"): a mismatch in wording. Against the binding "API contract" section of the design (`ProviderRef` gains `shared`; `effective` = the shared row with `shared: true` and `last_test_status: null`) and the spec's forbidden list (key, key hint, base URL, parameters, test result): no violation. The id is not a secret, and every route that takes it answers 404 for a member (`test_shared_row_is_hidden_from_other_users`, `test_assigning_the_shared_configuration_is_refused`, override matches only own rows). Recommendation: either blank `id` and `provider_type` in `shared_ref`, or reword proposal decision 4 and design decision 6 to match the contract. Not a blocker.
3. **Provider errors in shared mode** (`routes/agent.py:218-223`): the 502 detail is name, model and error category only, never the provider's own message. Good.

## Project rules

- The only reads of another user's rows are in `resolve.py` (`shared_rows`: the admin's rows that are `shared`, active and not Claude Code); all provider routes still filter by the current user.
- Admin: `in_shared_mode` returns None for the admin, so never counted and no limit (`test_admin_is_not_counted`).
- No key in logs or answers: a refused request logs `"shared limit"` and `user_id` only; tests assert the key and hint are absent from answers.
- Edit UI: the provider form keeps Save and Cancel; the switch follows its Save rule.

## Test changes (no test weakened)

`test_agent_providers_api.py` gains `"shared": False` in the expected ref; `conftest.py` truncates `shared_usage`; `fakeApi.ts` is additive. No assertion removed.

## Notes

- `design.md` decision 5 says "every route that calls `resolve_chain`"; only the chat route does, and it counts.
- A request refused with 429 runs no model; the count is committed before any model is built, so a later failure still counts, as designed.
