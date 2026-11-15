# Change: Note header edits are explicit and undoable

## Why

A note of the owner ("Agentic Engineer" interview notes) ended up titled "chuong 1" and linked to `o-to-hang-b/chuong-1` (2026-11-16, note `f16e4237…`). No agent tool renames or links notes; the edits came from the note header, where the title is an always-editable text field that saves on Enter and the node picker, until `note-link-picker`, saved on change. A user who treats the header as a search or navigation bar changes their data without meaning to, and nothing offers a way back.

## What changes

- The note title is shown as a heading, not a text field. Renaming is an explicit action: a Rename button next to the title and a Rename item in More actions open the title field with Save (disabled until the text changes) and Cancel; Enter saves, Escape cancels. Nothing else on the page edits the title.
- After a rename or a saved link change on the note page, a status line offers Undo for a few seconds ("Renamed to ‘chuong 1’. Undo" / "Linked to chuong-1. Undo"); Undo puts the previous title or link back.
- The "Linked to" picker keeps Save link / Cancel link change from `note-link-picker`.

## Impact

- Spec: `learning-views` (Read a note).
- Frontend only: `NoteView.tsx`, `NoteView.test.tsx`, `index.css`; e2e `note-edit.e2e.ts` (title tests go through Rename), `curation.e2e.ts` (header one-line test: the heading instead of the textbox), any other e2e that fills the "Note title" textbox directly.
- No backend change.
