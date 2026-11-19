# Tasks

Contract: `design.md` and `specs/app-search/spec.md`. Do the backend first, then the frontend, then e2e. Run one backend test run at a time.

## 1. Backend

- [ ] 1.1 `app/text_search.py` with `like_pattern` and `snippet` (design 1). `app/agent/tools.py` `search_notes` uses them, and `_snippet` and the inline escaping go. Verify: the existing `search_notes` tests pass unchanged (`tests/test_agent_chat.py`, `tests/test_archive.py`, `tests/test_note_content.py`), plus `ruff check . && ruff format --check .` and `mypy app`.
- [ ] 1.2 `app/routes/search.py`: `GET /api/search` with `SearchOut` (design 2-5), registered with the session-gated routers in `app/main.py`. `tests/test_search.py` covers every scenario of the spec's requirements Search route, Matching, Topics group, Lessons group and Notes group: short text, 101 characters → 422, 401 without a session, case, `%`/`_` literal, topic tiers and limit 5, another member's private area, lesson excerpt, lesson order and limit 5, lessons on topics not in the catalog left out, archived notes left out, note title tier first, then newest, limit 8. Verify: `pytest tests/test_search.py`, `ruff`, `mypy app`.
- [ ] 1.3 `tests/test_isolation_search.py` for the requirement "Search is scoped to the user" (both scenarios: the admin's lesson and note invisible to the member, and each user finds only their own "Zebra notes"). Verify: `pytest tests/test_isolation_search.py`, then the full `pytest`.

## 2. Frontend

- [ ] 2.1 `src/api.ts`: `api.search`, `queryKeys.search` and the types (design 7). `src/components/TopSearch.tsx` (design 8), shown in `TopBar` on desktop and tablet when signed in (design 10), with styles in the existing stylesheet for light and dark. `src/components/TopSearch.test.tsx`: debounce and the 2-character minimum (no request for `a`), headings only for non-empty groups, "No results for “…”", Arrow Down/Up across groups, Enter and click navigate to `#/lesson/<domain>/<node>` and `#/note/<id>` and clear the box, Escape closes, a markup title renders as text with no `img`. Verify: `npm test`, `npm run lint`, `npm run build`.
- [ ] 2.2 Phone (design 9): the search button in `TopBar` opens a full-width search row with the input focused, and Escape on an empty field or the close button hides it. The dropdown never scrolls the page sideways. Add a Vitest case in `TopBar.test.tsx` or `TopSearch.test.tsx` for opening and closing on the phone screen class. Verify: `npm test`, `npm run lint`, `npm run build`.
- [ ] 2.3 README: one line under Features for the top-bar search. Verify: the line is present and names the three groups.

## 3. E2E and verification

- [ ] 3.1 qc-e2e: a new `e2e/search.e2e.ts` covers the scenarios of the spec's requirements "Search box in the top bar" and "Opening a search result" (nothing found, markup title, open a lesson, keyboard only, Escape closes). `responsive.e2e.ts` gets the "Search on a phone" scenario and a `responsive-*` screenshot with the dropdown open. Verify: `npm run e2e` passes.
- [ ] 3.2 qc-ui: inspect the new screenshots, light and dark, at desktop, tablet and phone sizes. Verify: no defect left, or each remaining defect is listed in `evidence.md`.
- [ ] 3.3 Every check in `CLAUDE.md` passes and `openspec validate global-search --strict` passes. Verify: the verifier report is in `verifier-report.md`.
