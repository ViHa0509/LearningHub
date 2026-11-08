## 1. Backend

- [x] 1.1 `NoteContentUpdate` schema and `content_sha256` on `NoteDetail`
- [x] 1.2 `PUT /api/notes/{id}/content`: validation (empty, size), 409 on stale `base_sha256` and on a duplicate page, no-op on the same page, store the new blob, re-extract `body_text`, remove the unused old blob
- [x] 1.3 Tests for every scenario of the page-replace requirement, including the guard header and keeping title, link and archived state

## 2. Frontend

- [x] 2.1 `api.ts`: `noteSource(id)` and `saveContent(id, html, baseSha)`; fake API support
- [x] 2.2 LearnedList rename: Save and Cancel buttons, Save disabled when empty or unchanged, no cancel on blur
- [x] 2.3 NoteView title: Save and Cancel when changed, no save on blur
- [x] 2.4 `NoteEditor`: source textarea, debounced sandboxed preview, Save (disabled until changed, Ctrl+S), Cancel with a discard confirmation, conflict and error messages; Edit page button; a guard on leaving while dirty
- [x] 2.5 Vitest for 2.2 to 2.4

## 3. Rules and e2e

- [x] 3.1 CLAUDE.md convention: every edit has an explicit Save
- [x] 3.2 qc-e2e: `note-edit.e2e.ts` for list rename Save and Cancel, note title Save, and edit page Save and Cancel; loop until the suite passes
