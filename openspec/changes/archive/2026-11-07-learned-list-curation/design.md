## Context

Notes are rows in `notes` (title, extracted text, original file key, optional `node_id`). `PATCH /api/notes/{id}` already renames and relinks; `NoteView` uses it. The Learned list (`LearnedList.tsx`) groups notes with `lib/grouping.ts`. Counts come from `routes/domains.py` (`learned_nodes`, per-node counts); the agent's `search_notes` tool queries `notes` directly.

## Goals / Non-Goals

**Goals:** archive and restore without losing anything; rename, move and archive from the list; an AI Engineer roadmap so AI learning has a place.

**Non-Goals:** editing a note's HTML (originals stay unchanged by spec); bulk actions; a KH connector (the KH notes are a one-off import with existing APIs).

## Decisions

1. **`archived_at` timestamp, not a status enum or a delete flag.** Nullable `TIMESTAMPTZ` on `notes`, migration 0005 (up adds the column, down drops it). `NULL` = active. A timestamp lets the Archived section sort newest-archived first at no extra cost.
2. **API.**
   - `PATCH /api/notes/{id}` accepts `archived: bool` together with or without `title`/`node_id`. `true` sets `archived_at = now()` if it is not set yet (idempotent); `false` clears it.
   - `GET /api/notes` excludes archived notes; `GET /api/notes?archived=true` returns only archived notes, newest-archived first. `node=` and `unsorted=` always exclude archived notes.
   - `NoteOut` and `NoteDetail` gain `archived_at: datetime | null`.
   - Counts in `routes/domains.py` (domain list `learned_nodes` and per-node counts) filter `archived_at IS NULL`.
   - The import's duplicate check still matches an archived note (same file = same note); the outcome stays `duplicate`, and the returned note shows `archived_at` so the UI can say so. No auto-restore.
3. **Agent.** `search_notes` filters `archived_at IS NULL`; `read_note` is unchanged (reads by id, archived or not).
4. **List UI.**
   - Each item row = the existing title button + a small "More actions" icon button (`aria-label="More actions for <title>"`, `aria-haspopup="menu"`), opening a menu (`role="menu"`, items `role="menuitem"`): Rename, Move to node, Archive. Escape or outside click closes it; focus returns to the trigger.
   - Rename swaps the title button for an input (`aria-label="New title"`), Enter saves (blank or unchanged = no call), Escape cancels.
   - Move to node opens the existing `NodePicker` in a dialog, with an "Unsorted" choice that sends `node_id: null`.
   - Archive acts at once (it is reversible; no confirmation). A small status line "Archived '<title>'. Undo" is shown for a few seconds; Undo restores.
   - The Archived section is a `<details>`-style disclosure below the groups: "Archived (N)", collapsed by default, listing archived notes (title button opens the note, Restore, Delete with an inline confirmation). It hides when N = 0. The title filter applies to it too.
   - The archived list is a separate query (`['notes', 'archived']`); every mutation invalidates `['notes']`, `['domains']` and the roadmap counts, as today.
5. **Note page.** An archived note shows a banner "This note is archived." with a Restore button; the action row shows Archive or Restore accordingly.
6. **AI Engineer roadmap.** `roadmaps/ai-engineer.yaml`, `order: 6`, 20 hand-written nodes in six top-level groups: LLM basics (prompting, multimodal models, tokens and cost), Retrieval (embeddings, vector search), Agents (tool calling, MCP, multi-agent orchestration), Agent harness (hooks, subagents, skills), AI-driven SDLC (spec-driven development, reviewing AI-written code), Evals, AI security. `roadmap.sh` link on lesson pages follows the existing pattern (`https://roadmap.sh/ai-engineer`).

7. **Visual identity (added at the user's request, no behavior change).** Modern, minimal, "knowledge + AI + discovery".
   - **Logo mark:** an abstract geometric brain merged with an open book, joined by soft neural-network lines and nodes; flat with a subtle gradient. It must stay readable at 16 px (favicon) and 24-32 px (top bar), so the small sizes use a simplified mark (book + 3 nodes).
   - **Palette:** deep indigo `#1E1B4B`, electric cyan `#22D3EE`, soft violet `#A78BFA`; dark-mode background `#0F0F12`. These become the theme tokens: the accent is cyan in dark and indigo in light, violet is the secondary accent, and contrast stays at WCAG AA for text and controls.
   - **Icons:** one monochrome inline-SVG set with 1.5 px strokes, `currentColor`, 24 px grid (home, roadmap, lesson, note, settings, agent, import, archive, restore, edit, move, more, sun, moon, system).
   - **Background:** dark mode gets a very subtle particle network with a soft glow behind the content (static SVG/CSS, no animation that runs while idle, hidden under `prefers-reduced-motion` and in light mode); it must not reduce text contrast.
   - **Assets:** `frontend/public/brand/` (logo SVGs, favicon SVG + 32 px PNG, app icon) and `docs/brand/` (a brand sheet page with the rules above). The app name stays "Learning Hub" in the wordmark until the user decides otherwise.

## Risks / Trade-offs

- Archived notes stay readable by the agent by id: intended (the user may be looking at one), and they are still the user's own data.
- Six cards change the home grid; the existing grid wraps, and qc-ui checks the screenshot.
- A duplicate import of an archived note stays archived; the import result says so, so the user is not left wondering where it went.

## Migration Plan

`alembic upgrade head` (0005). Downgrade drops the column and so un-archives everything, which is acceptable for a local single-user app.
