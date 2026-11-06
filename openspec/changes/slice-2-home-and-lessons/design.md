# Design

## Context

Slice 1 is archived (specs in `openspec/specs/`). The app is one React page whose center pane toggles between the map and a note by component state; there is no URL per page. Roadmaps live in YAML and in memory; notes in Postgres. The owner reviewed Slice 1 and asked for a roadmap.sh-like entry page, a page per node, simpler note opening, and a theme switch. Slice 3 (agent chat) will follow and needs lesson pages it can read and fill.

## Goals / Non-Goals

**Goals:**
- One addressable page per thing the user looks at (home, roadmap, lesson, note).
- Lesson content stored per node in the database, editable by hand now and writable by the agent later through the same API.
- A UI check suite that runs real browser flows against a real backend, so the UI QC agent has something deterministic to run.

**Non-Goals:**
- Fetching content from roadmap.sh into lessons (licensing and node mapping need their own decision; a link is enough now).
- Editing roadmaps from the UI.
- Drag-resizing panels.

## Decisions

### Hash routing without a router library

A 40-line `useRoute()` hook reads `location.hash`, parses it into `{page: 'home'} | {page: 'roadmap', domain} | {page: 'lesson', domain, node} | {page: 'note', id}`, and listens to `hashchange`; `navigate(route)` sets the hash. Alternative: React Router - well known, but adds a dependency and a data-router model for four routes. Hash routing also needs no server fallback, which matters because the backend never serves the SPA.

### Lessons in their own table, keyed by full node id

```
lessons
  node_id     text primary key     -- 'backend/caching'
  body        text not null        -- Markdown
  source      text not null        -- 'user' | 'agent' | 'import'
  updated_at  timestamptz not null
```

Like notes, no foreign key to nodes (roadmaps are not in the database); the API validates the node against the catalog. A lesson whose node later disappears stays in the table and is simply unreachable from the UI - same rule as notes ("editing roadmaps never deletes notes"). Alternative: put lesson text into the YAML - rejected, YAML is the hand-written skeleton, lesson text is user data and later agent output.

API: `GET /api/lessons/{domain}/{node}` returns `{node_id, body, source, updated_at}` (empty body and null source when none); `PUT` with `{body, source}` upserts, an empty or whitespace-only body deletes. Both 404 for unknown domain or node. The path has two segments, not `{full_id}`, so no encoded slash is needed.

### Progress on cards computed in `GET /api/domains`

`learned_nodes` = number of distinct node ids of the domain that have at least one note, from one grouped query over all notes. Five domains with about 25 nodes each make this trivial. Alternative: a separate stats endpoint - not needed yet.

### Markdown rendering with react-markdown

`react-markdown` does not render raw HTML unless `rehype-raw` is added, which matches the safety requirement. Alternative: `marked` + sanitizer - needs `dangerouslySetInnerHTML` and a sanitizer to stay safe.

### Theme

Tokens move from a single `prefers-color-scheme` block to: light tokens on `:root`, dark tokens under `:root[data-theme='dark']` and under `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }`. The theme choice (`system | light | dark`) lives in `localStorage` (wrapped in try/catch) and sets `data-theme` on `<html>`; "system" removes the attribute. An inline script is not needed; a flash of the system theme on load is acceptable for a local tool.

### Click behavior

- List note click opens the note (`#/note/<id>`) and also selects its node (domain and node state), so the map highlights it later.
- Map node click navigates to `#/lesson/<domain>/<node>`; the selected node follows the route, so the list keeps highlighting that node's notes.
- The roadmap map stays the domain's overview page; the lesson page has a "Back to map" link.

### E2E checks with Playwright on the installed Edge

`@playwright/test` with `channel: 'msedge'` uses the Edge already on the machine, so no browser download. The config starts two web servers: the backend on port 8001 with `LH_DATABASE_URL` pointing to a new `learninghub_e2e` database and `LH_STORAGE_DIR` to a temp folder, and Vite on port 5174 with `LH_API_URL=http://127.0.0.1:8001` (the proxy target becomes configurable). A global setup resets the e2e database with Alembic (`downgrade base`, `upgrade head`) and empties the storage folder. Tests save full-page screenshots of each page under `frontend/e2e-results/` for the UI QC agent to inspect. Alternative: run against the dev servers and dev database - rejected, checks must never touch dev data (CLAUDE.md convention).

The e2e command becomes a check row in CLAUDE.md. It needs Postgres up, like the backend tests, and must not run at the same time as the pytest check because both reset tables in their own databases only - they use different databases, so they can, but they compete for memory on the dev machine; the verifier runs checks one after another anyway.

### New roadmaps

Frontend, QA and Data Engineer YAML files written by hand in the same style (15-25 nodes, topics with subtopics), each with a one-sentence description. Domain order on the home page follows file names today (alphabetical); an optional top-level `order` field sets catalog order explicitly so the home page reads Frontend, Backend, DevOps, QA, Data Engineer.

## Risks / Trade-offs

- [Playwright on a memory-constrained laptop] -> One worker, Edge headless, two short-lived servers; the suite stays small (one spec per page).
- [Hash routes break if the app is later served behind a path-based router] -> Swapping the hook for a router is local to `useRoute`.
- [Lesson rows orphaned by removed nodes] -> Accepted, same as notes; a later cleanup view can list them.
- [react-markdown bundle size] -> About 40 kB gzip; acceptable.

## Migration Plan

Migration `0002_create_lessons` adds the table; `downgrade` drops it. Existing notes are untouched. Roadmap YAML gains optional fields, so old files still load.
