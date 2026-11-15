# Design

## Note header (`NoteView.tsx`, `.note-fields`)

- Default state: `<h1 className="note-title">` with the note's title (ellipsis on one line, `title` attribute with the full text), then an icon button `aria-label="Rename"` (pencil, `Icon name="edit"`, `className="icon icon-only"`), then the "Linked to" field, Save link / Cancel link change, Open lesson, the missing-node tag, as today. More actions gets a first item "Rename" (`Icon name="edit"`) above Edit page.
- Rename state (`renaming: boolean`): the heading and the pencil are replaced by `<input className="title-input" aria-label="Note title">` prefilled with the title and focused with its text selected, plus `Save title` (primary, disabled while the trimmed text is empty or equals the saved title) and `Cancel title change` in `span.title-actions`. Enter saves when Save is enabled; Escape cancels. Save calls `api.rename` through `run`, then leaves rename state and shows the undo line. Cancel leaves rename state without a request. Blur does nothing. Leaving the page while renaming discards the edit without a prompt (a single line, same as today's title field).
- Undo line: state `undo: { kind: 'title', previous: string, current: string } | { kind: 'link', previous: string | null, current: string | null } | null`, cleared by a timer after `UNDO_MS = 8000` (the list uses 5 s for archive; renames deserve a little longer) or by the next undoable action. Rendered under the header as `<p className="undo-line" role="status">` with the text "Renamed to ‘{current}’." or "Linked to {node title}." / "Unlinked." and a link-style button "Undo". Undo calls `api.rename(note.id, previous)` or `api.link(note.id, previous)` through `run`, clears the line, and shows no second undo. The node title comes from the roadmaps prop (`full_id` lookup; fall back to the id).
- The existing Save link path (`note-link-picker`) sets the link undo after a successful save.

## CSS

`.note-title { font-size: 16px; font-weight: 600; margin: 0; min-width: 0; flex: 1 1 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`; `.undo-line` exists (list). The header stays on one line at 1280 px with both panes open (`curation.e2e.ts`).

## Tests

- Vitest `NoteView.test.tsx`: the title is a heading and there is no "Note title" textbox until Rename; Rename (button and menu item) opens the field focused with the text selected; Save disabled until changed; Enter saves; Escape and Cancel close without a request; blur sends nothing; after a rename the undo line shows and Undo sends the previous title; after Save link the undo line shows "Linked to …" and Undo sends the previous node (including `null` for an unlinked note); the undo line disappears after 8 s (fake timers) and on the next action.
- E2E `note-edit.e2e.ts`: the rename test goes through the Rename button; a new test for Undo after rename and after a link change (the API reports the previous value again). `curation.e2e.ts` one-line test uses the heading `getByRole('heading', { name: note.title })`.
