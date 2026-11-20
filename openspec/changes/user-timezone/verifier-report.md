# Verifier report: user-timezone

Verdict: **pass** (2026-11-20, `ai-sdlc-kit:verifier`; read-only, so the report is the only file written)

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
| `openspec validate user-timezone --strict` | 0 | pass ("Change 'user-timezone' is valid") |

## Task evidence

| Task | Status | Evidence |
|---|---|---|
| 1.1 migration and model | evidence found | `alembic/versions/0022_user_timezone.py`, `User.timezone` in `app/db.py:476`, `test_migrations.py` column list |
| 1.2 `MeOut.timezone`, `PUT /api/auth/timezone`, `tzdata` | evidence found | `routes/auth.py:240-251` (64-char cap, `available_timezones()`, 422 `unknown time zone`, own row only), `requirements.txt:17` and `pyproject.toml:24` pin `tzdata`, `tests/test_auth_timezone.py` |
| 2.1 `lib/time.ts`, every timestamp moved | evidence found | `lib/time.ts` with fallback; no `toLocale*Date/Time` or `getHours`-style formatting left outside it (only number `toLocaleString` in `ProviderPage.tsx:959,965`, not a timestamp); `lib/time.test.ts` |
| 2.2 dialog and Account field | evidence found | `TimeZoneDialog.tsx`, `AccountSettings.tsx`, `AppShell.tsx:393`, dismissal cleared at sign-out (`lib/auth.ts:105`, `AppShell.tsx:66`); `TimeZone.test.tsx`; `fakeApi.ts` default user has `UTC` |
| 3.1 qc-e2e | unchecked; evidence now supports checking | `frontend/e2e/user-timezone.e2e.ts` covers every scenario, with light, dark and phone screenshots; `owner.setup.ts` sets the owner's zone; the batched e2e run passed (see Checks) |
| 3.2 verifier report | this report | |

## Scenario to test map

| Scenario | Test |
|---|---|
| Asked after sign-in | `TimeZone.test.tsx:30,45,55`; `test_auth_timezone.py` (`test_new_member_has_no_zone_and_save_stores_it`); `user-timezone.e2e.ts:69` |
| Not now | `TimeZone.test.tsx:63,77`; `test_nothing_is_stored_without_a_save`; e2e `:108` |
| Not asked again | `TimeZone.test.tsx:97`; `test_zone_survives_a_new_sign_in` |
| Change in Settings | `TimeZone.test.tsx:117,137,148`; `test_zone_can_be_changed`; e2e `:145` |
| Unknown name | `test_unknown_names_are_refused_and_change_nothing`, `test_null_and_missing_values_are_refused`; e2e `:183` |
| Missing header | `test_missing_header_is_forbidden`; e2e `:183` |
| Chosen zone | `TimeZone.test.tsx:187`, `time.test.ts:9`; e2e `:241` |
| No zone yet | `TimeZone.test.tsx:192`, `time.test.ts:35`; e2e `:258` |

Uncovered scenarios: none.

## Test changes (no test weakened)

- `conftest.py`, `fakeApi.ts`, `TopBar.test.tsx`: default user gets a zone (additive).
- `test_migrations.py`: `timezone` added to the expected column set (additive).
- `members.e2e.ts`: Settings nav lists gain `Account` (the new section); the member test now saves the zone in the dialog. `learning-fields.e2e.ts`, `practice-exams.e2e.ts`, `owner.setup.ts`: set a zone through the API so the dialog does not cover the pages. No assertion removed.

## Notes

- Server counting stays UTC, as the proposal says. The shared-providers `resets_at` is formatted in the user's zone (`SharedProviders.test.tsx:172`).
- The dialog has `aria-modal` and Escape, but no focus trap; the spec does not ask for one.
- Backup does not carry the zone (design decision 8): `timezone` is a `users` column, not in the archive.
