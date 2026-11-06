# Proposal

## Why

The first review of Slice 1 (2026-11-07) found the app hard to enter and hard to read: it opens straight onto one map with no overview of the roles one can learn, a roadmap node only highlights notes instead of telling what the topic is, opening a note needs a separate "Open" button, and the theme follows the operating system with no way to change it. Fixing navigation now, before the agent lands in the right panel, gives the agent pages to point at (a lesson per node) and gives UI checks something stable to test.

## What Changes

- A home page like roadmap.sh: one card per role (Frontend, Backend, DevOps, QA, Data Engineer) with a short description and learning progress; clicking a card opens that role's roadmap.
- Three more hand-written roadmaps (Frontend, QA, Data Engineer) and a short description per domain in its YAML file.
- A lesson page for every roadmap node: breadcrumb, the node's description, its subtopics, the notes linked to it, and editable lesson content (empty until the user writes it or, later, the agent fills it), with a link to roadmap.sh for further reading.
- Clicking a node on the map opens its lesson page (it still highlights the node's notes in the list).
- Clicking a note in the learned list opens it directly; the separate "Open" button is removed. **BREAKING** for the list's click behavior (select-only is gone).
- Light, dark or system theme, switchable from a top bar and remembered in the browser.
- Addressable pages through the URL hash (`#/`, `#/roadmap/<domain>`, `#/lesson/<domain>/<node>`, `#/note/<id>`) so the browser back button works and pages can be linked.
- An end-to-end UI check suite (Playwright, driving the installed Microsoft Edge) against a real backend and a separate database, added as a CLAUDE.md check so the verifier and the UI QC agent run it.

## Capabilities

### New Capabilities
- `home-page`: the role overview with one card per domain, description and progress, as the app's entry page.
- `lesson-pages`: one page per roadmap node with its description, subtopics, linked notes and stored, editable lesson content.

### Modified Capabilities
- `roadmap-catalog`: domains gain a short description; the shipped roadmaps grow from two to five; listing domains also returns description and progress.
- `learning-views`: a top bar with app title and theme switch; clicking a list note opens it; clicking a node opens its lesson page; pages are addressable by URL.

## Impact

- Backend: new `lessons` table (Alembic migration 0002), `GET/PUT /api/lessons/{domain}/{node}`, `GET /api/domains` returns `description`, `learned_nodes`; roadmap YAML gains `description` at domain level.
- Frontend: new `HomePage`, `LessonPage`, `TopBar` components, a small hash router (no new routing dependency), `react-markdown` for lesson content, theme tokens for explicit light and dark.
- Tests: new pytest and Vitest cases; new `frontend/e2e/` Playwright suite with `@playwright/test` (no browser download, uses `channel: 'msedge'`), a `learninghub_e2e` database, and a new check row in CLAUDE.md.
- No change to note import, storage or the original-page sandbox.
