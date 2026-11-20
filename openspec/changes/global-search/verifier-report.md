# Verifier report: global-search

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
| `openspec validate global-search --strict` | 0 | pass ("Change 'global-search' is valid") |

## Task evidence

| Task | Status | Evidence |
|---|---|---|
| 1.1 `text_search.py`, `search_notes` uses it | evidence found | `app/text_search.py`; `agent/tools.py` imports `like_pattern` and `snippet`; `_snippet` and the inline escaping are gone; the existing agent tests are in the passing backend run |
| 1.2 `routes/search.py` and `tests/test_search.py` | evidence found | route registered in `app/main.py`; 14 tests, one per listed case |
| 1.3 `tests/test_isolation_search.py` | evidence found | three tests (admin's data invisible, "Zebra notes", own lesson) |
| 2.1 `TopSearch.tsx`, api, tests | evidence found | `TopSearch.tsx` (React text only; no `dangerouslySetInnerHTML` or Markdown), `TopSearch.test.tsx` |
| 2.2 phone | evidence found | `TopBar.test.tsx` "TopBar search" block, `TopSearch.test.tsx` phone row |
| 2.3 README | evidence found | `README.md:13` names Topics, Lessons, Notes |
| 3.1 qc-e2e | unchecked; evidence now supports checking | `frontend/e2e/search.e2e.ts`, `responsive.e2e.ts:713` with the `search-dropdown` screenshots; the batched e2e run passed (see Checks) |
| 3.2 qc-ui | unchecked; not verified | no inspection record was given to the verifier |
| 3.3 checks and this report | this report | |

## Scenario to test map

| Scenario | Test |
|---|---|
| Short text / Too long / Not signed in | `test_search.py:49,57,64` |
| Case is ignored / Percent and underscore are literal | `test_search.py:73,83` |
| Title match first / Another member's private area (topics) | `test_search.py:97,140` (+ `:113,126`) |
| Lesson found with an excerpt / Most recently updated first | `test_search.py:154,165` (+ `:180` lessons off the catalog) |
| Archived notes are left out / Title match first (notes) | `test_search.py:196,204` (+ `:213` limit 8) |
| Member cannot find the admin's data / Each user finds their own | `test_isolation_search.py:9,24`; e2e `search.e2e.ts:232` |
| Nothing found / Markup in a note title | `TopSearch.test.tsx:104,112`; e2e `:124,158` |
| Open a lesson / Keyboard only / Escape closes | `TopSearch.test.tsx:131,150,169,199`; e2e `:173,185,223` |
| Phone | `TopBar.test.tsx`, `TopSearch.test.tsx:227-247`; `responsive.e2e.ts:713` |

Uncovered scenarios: none.

## Judgement: `LessonHit.source` allows `import`

`LessonHit.source` is typed `LessonSource = Literal["user", "agent", "import"]` (`app/schemas.py:81`). The design names user and agent. `import` is a real stored lesson source (lessons imported from HTML as Markdown), so narrowing the type would make the route fail on those lessons. The code is right; the spec text ("whether the user or the agent wrote it") and the design are incomplete. Update both to say `user`, `agent` or `import`. Not a blocker.

## Project rules

- Every lesson and note query filters by `user.id` from `CurrentUser`; topics come from the per-user `UserCatalog`. The route is in the session-gated router list.
- Matching: `like_pattern` escapes `\`, `%`, `_`; `search_notes` uses the same helper.
- The route logs nothing.
- Query max length 100 gives 422; trimmed text under 2 characters answers empty groups without a query.

## Notes

- No migration and no index, as designed. A `pg_trgm` index remains a later step.
- `search_notes` still cuts the query at 200 characters; the route allows 100. Harmless.
