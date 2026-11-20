# Design

## Context

- **Lessons** are rows in `lessons`, keyed by `(user_id, node_id)` (`app/db.py:60`).
- **Notes** are rows in `notes`, with `user_id`, `title`, `body_text`, `node_id` and `archived_at` (`app/db.py:38`).
- **Topics** come from the per-request user catalog: `UserCatalog` in `app/learning/catalog.py` builds the built-in roadmaps plus the user's own fields and the published ones. It is in memory and small (hundreds of nodes).
- **Existing matching:** the only text search today is the agent's `search_notes` (`app/agent/tools.py:332`): `ILIKE` with `\`, `%` and `_` escaped, and `_snippet` for an excerpt.
- **Top bar:** `src/components/TopBar.tsx` has the brand, News, the theme switch, the phone drawer buttons and the account menu.
- **Routing:** pages are hash routes (`src/lib/route.ts`): `#/lesson/<domain>/<node>` and `#/note/<id>`. `navigate()` already asks before leaving unsaved changes.

## Goals / Non-Goals

**Goals:**
- One route answers all three groups in one request, so the dropdown appears at once.
- The same matching rules as `search_notes`, so the agent and the box find the same notes.

**Non-Goals:**
- Ranking by relevance, word stemming, typo tolerance, Vietnamese accent folding (no `unaccent`).
- Searching chats, references, practice questions or news (News keeps its own filter).
- A full results page or "show more"; a keyboard shortcut to focus the box.
- A trigram or full-text index.

## Decisions

1. **Shared matching helpers: new module `app/text_search.py`.**
   - `like_pattern(query) -> str`: escapes `\`, `%` and `_`, then wraps in `%`. Used with `ilike(..., escape="\\")`.
   - `snippet(text, query, width=90) -> str`: moved from `app/agent/tools.py` (`_snippet`) unchanged.
   - `search_notes` imports both, so its behavior and tests stay the same.
   - Alternative: copy the code into the route. Rejected, because two copies would drift.

2. **Route `GET /api/search` in `app/routes/search.py`.**
   - Router prefix `/api/search`, added to the session-gated router list in `app/main.py`, so a request without a session gets 401 like other data routes.
   - Dependencies: `CurrentUser`, `UserCatalog`, `DbDep`. Query `q: str = Query(max_length=100)`, so more than 100 characters answers 422 from validation.
   - After `strip()`, fewer than 2 characters answers empty groups without querying.
   - Response model `SearchOut { query, topics: [TopicHit], lessons: [LessonHit], notes: [NoteHit] }`:
     - `TopicHit { node_id, title, domain_title }`
     - `LessonHit { node_id, title, domain_title, source, snippet }` (`source` is the lesson's stored source: `user`, `agent` or `import`)
     - `NoteHit { id, title, node_id | null, snippet }`
   - GET with no side effect, so the `X-LearningHub` header is not required.

3. **Topics in memory.**
   - Walk `catalog.domains()` and their nodes in order. Lowercased `query in title` puts a node in the title tier, else a description match puts it in the description tier.
   - Concatenate the tiers and cut at 5.
   - No database query. The catalog is already per user, so other members' unpublished areas are never visible.

4. **Lessons query.**
   - `select(Lesson).where(Lesson.user_id == user.id, Lesson.body.ilike(pattern, escape="\\")).order_by(Lesson.updated_at.desc(), Lesson.node_id)`.
   - Rows whose `node_id` is not in the catalog are skipped (no page to open), and the loop stops at 5 hits.
   - The SQL limit is 50, so a few orphan lessons cannot empty the group.
   - The title and the roadmap or area title come from `catalog.node()` and `catalog.domain()`.

5. **Notes query.**
   - `user_id == user.id`, `archived_at IS NULL`, and `title` or `body_text` ILIKE the pattern.
   - Order: `case((Note.title.ilike(pattern), 0), else_=1)`, then `created_at desc`, then `id`. Limit 8.
   - The excerpt comes from `body_text`.

6. **User scope.** Every query names `user.id` from `CurrentUser`, as `app/auth/current.py` requires. Topics come from the user's own catalog. Isolation tests go in `tests/test_isolation_search.py`, following `tests/test_isolation_notes.py`.

7. **Frontend data.**
   - `api.search(q)` → `GET /api/search?q=` (encoded).
   - `queryKeys.search(q)`.
   - Types `SearchResult`, `TopicHit`, `LessonHit`, `NoteHit` in `src/api.ts`.

8. **Component `src/components/TopSearch.tsx`.**
   - State: the input text, plus a debounced value (250 ms) driving `useQuery({ queryKey: queryKeys.search(debounced), enabled: debounced.trim().length >= 2, staleTime: 30_000 })`.
   - It runs while typing, so the search box keeps the text and refreshes results without overwriting what the user types.
   - ARIA combobox pattern:
     - the input has `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`
     - the dropdown is a `role="listbox"` with group headings (`role="presentation"` labels) and `role="option"` items
     - the flat option list makes Arrow keys cross group borders and wrap
   - Enter opens the highlighted option through `navigate()`: `{ page: 'lesson', domain, node }` for topics and lessons, `{ page: 'note', id }` for notes. It then clears the text and closes.
   - Escape closes the dropdown without clearing the text. A click outside closes it too.
   - Titles and excerpts are rendered as React text nodes only: no `dangerouslySetInnerHTML` and no Markdown component.
   - The matched part of an excerpt is not highlighted in this change (plain text keeps it simple and safe).
   - Desktop and tablet: the box sits between the brand and `top-actions` and grows to fill the space, max width 480 px.

9. **Phone.**
   - `TopBar` gets a search icon button (`aria-label="Search"`) next to the theme button.
   - The button opens `TopSearch` in a full-width row under the top bar, with the input focused. Escape on an empty field, or the close button, hides the row.
   - The dropdown takes the full width, with a max height and its own scroll, so the page never scrolls sideways.

10. **Hidden when signed out.** `TopSearch` renders only when `user` is set: auth pages have no top-bar search.

## Risks / Trade-offs

- **[Slow searches]** ILIKE with leading `%` scans the user's lessons and notes. → Each user has hundreds of rows, not millions, and the debounce plus a 2-character minimum keeps calls rare. A `pg_trgm` GIN index is the next step if a query takes more than ~200 ms (a migration; Supabase supports `pg_trgm`).
- **[Accents]** Vietnamese text with accents does not match a search typed without accents. → Out of scope (non-goal). `unaccent` can come with the trigram step.
- **[Untrusted text in results]** Note titles come from imported HTML. → They are rendered as text only, with a test using a markup title.
- **[Agent search behavior]** Moving `_snippet` and the escaping into a shared module could change `search_notes`. → The existing `search_notes` tests must pass unchanged.

## Migration Plan

No migration. Deploy as usual (CI checks, then the Vercel deploy hook). Rollback is reverting the commit.
