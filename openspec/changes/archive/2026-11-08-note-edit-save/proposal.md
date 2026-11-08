## Why

Renaming a note in the learned list has no Save button: the title is saved only by pressing Enter, and a click elsewhere silently drops the edit. The note page saves its title on blur, with no visible save step. The user also wants to edit the content of a learned page after opening it, for example to fix or extend a rewritten study note, and every edit must end with an explicit Save.

## What Changes

- Rename in the learned list shows the title field with **Save** and **Cancel** buttons. Enter saves, Escape cancels, and Save is disabled while the title is empty or unchanged.
- The title on the note page shows **Save** and **Cancel** as soon as it differs from the saved title. It is no longer saved on blur.
- The note page gets an **Edit page** button. It opens an HTML source editor with a live preview in the same isolated frame. **Save** stores the new HTML as the note's page, and Ctrl+S also saves. **Cancel** discards the edit, after a confirmation when there are unsaved changes. Leaving the page with unsaved changes asks first.
- New endpoint `PUT /api/notes/{id}/content` replaces a note's stored page. It re-extracts the searchable text and keeps the title, link and archived state. It rejects empty or oversized pages, and pages identical to another note's page. It returns 409 when `base_sha256` does not match the current page, so an edit made in a stale tab is not saved over a newer one.
- Project rule (CLAUDE.md conventions): every edit UI has an explicit Save, and edits are never saved silently on blur.

## Capabilities

### New Capabilities

### Modified Capabilities
- `knowledge-import`: notes can have their stored page replaced. The new text is used for search.
- `learning-views`: Rename in the list and the note title have Save and Cancel; the note page has an HTML editor with Save.

## Impact

- Backend: `app/routes/notes.py` (new route), `app/schemas.py` (`NoteContentUpdate`, `content_sha256` on `NoteDetail`), plus tests. No migration: the existing columns hold everything.
- Frontend: `LearnedList.tsx`, `NoteView.tsx`, new `NoteEditor.tsx`, `api.ts`, the fake API, and CSS.
- E2E: a new `note-edit.e2e.ts`.
