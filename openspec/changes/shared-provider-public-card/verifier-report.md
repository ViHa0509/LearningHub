# Verifier report: shared-provider-public-card

Verdict: **pass** (2026-11-21, `ai-sdlc-kit:verifier`; the verifier is read-only, so this file is the only one it created)

## Checks

| Command | Exit | Result |
|---|---|---|
| `cd backend && .venv/Scripts/python -m pytest` | not rerun by the verifier | The main session ran `tests/test_shared_providers.py tests/test_search.py tests/test_auth_timezone.py` on this tree: 57 passed. The full suite runs in CI on push (last full run, commit 26de31d, before this change: 1219 passed). |
| `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .` | 0 | pass ("All checks passed!", "191 files already formatted") |
| `cd backend && .venv/Scripts/mypy app` | 0 | pass ("Success: no issues found in 91 source files") |
| `cd frontend && npm test` | 0 | pass (46 files, 621 tests) |
| `cd frontend && npm run lint` | 0 | pass (oxlint, no output) |
| `cd frontend && npm run build` | 0 | pass (chunk-size warning only) |
| `cd frontend && npm run e2e` | not rerun by the verifier | The main session ran `shared-providers.e2e.ts` (15 passed) and `providers.e2e.ts agents-settings.e2e.ts user-timezone.e2e.ts` (43 passed). The full suite runs in CI on push (last full run, commit 26de31d: 346 passed). |
| `openspec validate shared-provider-public-card --strict` | 0 | pass ("Change 'shared-provider-public-card' is valid") |

## Task evidence

| Task | Status | Evidence |
|---|---|---|
| 1.1 `SharedProviderCard`, admin tag "Public", styles, Vitest | `[x]` evidence found | `SettingsPage.tsx` (`SharedProviderCard`, tag "Public" on `ProviderCard`), `index.css` (`.shared-card .shared-usage`), `SharedProviders.test.tsx`; test, lint and build pass above. |
| 2.1 `qc-e2e` covers the five scenarios, screenshots, touched e2e files pass | unchecked | Evidence supports it for the touched files: `shared-providers.e2e.ts` 15 passed, `providers`, `agents-settings`, `user-timezone` 43 passed (main-session runs, not rerun here). It stays open until `qc-e2e` has run after the last dev fix and the main session marks it. |
| 2.2 verifier report: pass | unchecked | This report. |

## Scenario to test map

| Scenario | Unit test (`SharedProviders.test.tsx`) | E2E (`shared-providers.e2e.ts`) |
|---|---|---|
| Admin sees Public | "ticks Shared with all users, saves, and the list shows a Public badge" (about :36); "shows no Public badge on a member own configuration" | "Admin shares" test (about :235): Public on MAIN, none on FAST |
| Member sees the shared provider as an entry | "lists the shared provider as a read-only Public entry on the providers page" (about :150) | "Shared configuration for a user without one" (about :344): heading, Public, "fake-ok", "Shared by the admin", "0 of LIMIT requests used today" |
| The entry is read-only | same unit test: no link, no button, no `anthropic`/Active/Inactive/Not tested/key hint text | same e2e test: no link, no button, no Active/Inactive, text holds no `key`, `local`, `127.0.0.1`, `8002`, `http` |
| Member with their own provider | "shows no Public entry when the member has an own active configuration" | "Own configuration wins over a shared one" (about :385): own card, no MAIN card, no Public, no "Shared by the admin" |
| Sharing withdrawn | withdrawn test (about :249): `queryByText('Public')` absent next to the existing warning and empty-list assertions | "Warning when withdrawn" (about :547): no MAIN article, no Public, next to the existing warning check |

Uncovered scenarios: none.

## Judgement

- **Member card JSX** (`SettingsPage.tsx`, `SharedProviderCard`): an `<article aria-label=name>` with `<h2>` name (plain text, no link), the "Public" tag, `provider.model_name`, "Shared by the admin" and the usage line. It renders no `id`, `provider_type`, key hint, base URL, status badge, link or control. It takes a `ProviderRef`, which does not carry the key or URL.
- **Edited assertions, line by line.** Unit: the three "Shared" -> "Public" text swaps and two test names (the spec's wording change). The old "same line and count above the empty list" test was replaced by the card test; the removed `Uses ... shared by the admin` and count assertions describe the paragraph the spec replaced. `Uses ...` lines in the Agents tab are untouched (`sharedLine` is still used by `AgentsSettings.tsx`). The count text is still asserted, now inside the card. Added assertions only: withdrawn "Public" absent, own-config test. E2E: two "Shared" -> "Public" swaps; the member's providers-page block flips the old `Uses ... (fake-ok), shared by the admin` assertion to `toHaveCount(0)` (spec change), and the old `getByRole('article')).toHaveCount(0)` becomes exactly 1 article (the card), a deliberate change; the usage-count assertion is kept, now on the card. Everything else added is stricter. Nothing is weakened beyond the spec.
- **Database host fix** (`backend/app/config.py`, `backend/tests/conftest.py`, `frontend/playwright.config.ts`): only `localhost` -> `127.0.0.1` in three URL strings. Same port, user, password and databases; the test and e2e databases stay `learninghub_test` and `learninghub_e2e`. Nothing else changes. Side note: a `.env` or CI that sets `LH_DATABASE_URL` is unaffected, since it only changes the default.

## Notes

- The full backend pytest and full e2e were not rerun here (cost and memory on this PC); they are covered by the main-session runs above and the CI run on push.
- Task 2.1 and 2.2 are correctly open; `tasks.md` was not edited.
- The e2e secret check is a substring check (`key`, `local`, ...) on the card text after removing the provider name; it would fail on a name or model that contains those words, but the fixtures do not.
