# Proposal

## Why

Past learning can only be found by walking the maps or by asking the agent. The top bar has no search, and no route searches lessons at all: the only text search over notes is the agent's `search_notes` tool, and lessons, the main thing the owner writes, cannot be searched anywhere. The owner wants one search box that finds anything in their own learning data, and never another member's data.

## What Changes

- A search box in the top bar on every page. Typing at least 2 characters shows a dropdown with results grouped as **Topics**, **Lessons** and **Notes**. A click, or Enter on the highlighted result, opens it. Arrow keys move through the results and Escape closes the dropdown.
- Topics: the roadmap topics the signed-in user can see (built-in roadmaps plus their own and published areas), matched on title and description. A topic result opens its lesson page.
- Lessons: the signed-in user's own lessons, matched on the lesson text, with an excerpt around the match. A result opens the lesson page.
- Notes: the signed-in user's own notes that are not archived, matched on title and text, with an excerpt. A result opens the note page.
- Matching is case-insensitive substring matching, and `%` and `_` are literal characters. Each group has a fixed limit and a stated order.
- On a phone, the top bar shows a search button that opens a full-width search field with the same dropdown.
- A new route `GET /api/search?q=` that answers the three groups. Every lesson and note query is filtered by the current user. Another member's lessons and notes never appear.
- Result text (titles, excerpts) is shown as plain text, never as HTML or Markdown.

## Capabilities

### New Capabilities

- `app-search`: searching the signed-in user's own learning data (topics they can see, their lessons, their notes) from the top bar. This covers the search route and the search box.

### Modified Capabilities

(none)

## Impact

- Backend: new `app/routes/search.py`, registered with the other session-gated routers in `app/main.py`. The excerpt and LIKE-escaping helpers used by the agent's `search_notes` (`app/agent/tools.py`) move to a shared module so both use the same matching.
- Backend tests: route behavior (groups, limits, order, escaping, archived notes, minimum length) and a per-user isolation test next to `tests/test_isolation_notes.py`.
- Frontend: a new search component in the top bar (`src/components/TopBar.tsx`), `api.search` and a query key in `src/api.ts`, styles for the dropdown and the phone field. Vitest tests next to the component.
- E2E: a new e2e file for searching and opening results; phone and tablet screenshots through `responsive.e2e.ts`.
- README: one line under Features.
- No migration, no new extension or dependency. A trigram index can come later if search gets slow.
