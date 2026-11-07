# Evidence log: ai-provider-management

Built on 2026-11-07 from the owner's brief "AI Provider Management for Multi-Agent System", adapted to Learning Hub (see design.md, Context). It ran as a `/loop`: dev agents built the change, `qc-e2e` tested it, failures went back to the dev agents, and the loop repeated until the suite passed.

## Who did what

| Step | Agent (model) | Result |
|---|---|---|
| Specs, design, API contract | main session (opus) | `openspec validate --strict` pass |
| Backend tasks 1.1-1.5 (migration, SSRF, encryption, factory, fallback, logging) | implementer (opus; security-sensitive per the routing table) | 241 tests, ruff and mypy clean; 11 design deviations recorded below |
| Frontend tasks 2.1-2.3 | implementer (sonnet), in parallel against the same contract | 87 tests, lint and build clean |
| Fake LLM server and e2e specs, tasks 3.1-3.2 | qc-e2e (sonnet), new kit 0.3.0 agent | round 1: 34/35, 1 product bug |
| Fix for the round-1 bug | frontend implementer (sonnet, resumed) | 87 tests |
| Re-run | qc-e2e (sonnet, resumed) | round 2: **35/35 pass** |
| Final checks, docs | main session | all CLAUDE.md checks green |

## Dev -> QC -> fix loop

| Round | QC result | Product bug | Fix |
|---|---|---|---|
| 1 | fail, 34 passed, 1 failed | After deleting a provider, the page stayed on the confirm dialog for about 7 s and logged a 404. `remove()` waited for a refresh that refetched the deleted provider, and react-query retried that request. | Navigate right after the 204. The deleted provider's detail query is removed, never refetched. A Vitest test checks that no GET follows. |
| 2 | **pass**, 35 passed | none | none |

QC also fixed its own test bugs in round 1:
- chat requests sent `page: null`;
- two old tests targeted the removed per-vendor settings.

## Scenarios not testable end to end, and their unit-test cover

| Scenario | Covered by |
|---|---|
| Unset parameters are not sent | Adapter tests with stubbed SDK clients that check the exact request parameters per type |
| Key never logged, encrypted in the database | caplog test, plus database row tests |
| `.env` key imported | Migration and import tests (the e2e backend blanks the `LH_*` keys on purpose) |
| LLM calls observable without secrets, fallback log event | caplog tests |

## Deviations from design.md (reported by the backend developer, accepted)

1. The `.env` import runs at app startup, not in `create_app`, so that importing `app.main` in tests does not write to the dev database.
2. The header guard also covers `POST /api/agent/chat` and `POST /api/ai-providers/test`. Chat can write lessons, and the test makes outbound calls.
3. An unknown provider or the same provider twice in `PUT /api/agents/{id}/provider` returns 422 with `detail[].field`.
4. Request-shape errors on `/api/ai-providers*` and `/api/agents*` use `detail: [{field, msg}]`.
5. `types.params` includes `timeout` and `context_window`.
6. A base URL equal to the type's own default endpoint skips the DNS check.
7. A per-request override has no fallback.
8. The fallback client is built lazily, on the first recoverable error.
9. Provider error messages that echo a key are redacted to "(key)". The `llm.fallback` record carries `fallback_provider_id`.
10. `alembic/env.py` keeps existing loggers (`disable_existing_loggers=False`).
11. Catalog model ids for Gemini, Local and Custom are unverified. "Load models" and Test Connection show the real ones.

## Checks (final)

- Backend: `pytest` 241 passed; ruff check and format clean; mypy clean (33 files).
- Frontend: Vitest 87 passed; oxlint clean; build ok.
- E2E: 35 passed (qc-e2e round 2), with the fake LLM server on port 8002. No real provider was called.

## Not verified

- Real calls to OpenAI, Anthropic, Gemini, DeepSeek or Ollama: there is no key or local model on this machine. The owner's first Test Connection in Settings is that check.
- DNS rebinding between the SSRF check and the connection: an accepted gap (see design.md, Risks).
