## Why

The Edit page editor shows raw HTML next to a preview. The user only wants to change the text of a learned page: click the line on the page itself, change it, and save, without ever seeing HTML.

## What Changes

- **Edit page** turns the rendered page itself into an editor.
  - The text blocks of the page (headings, paragraphs, list items, table cells and other elements with their own text) become editable in place, with a visible outline on hover and on focus.
  - The page's own scripts keep running, so hidden parts (for example, answers that a click reveals) can be opened and edited too.
  - Pasted text is inserted as plain text.
- The bar above the page shows how many blocks changed, plus **Save** (disabled until something changes; Ctrl+S also saves, even with focus inside the page) and **Cancel**. Cancel and leaving the note still ask before unsaved changes are discarded.
- On save, only the blocks the user typed in are written back into the stored HTML. Changes the page's scripts made while it ran are not saved. The page is saved through the existing `PUT /api/notes/{id}/content`.
- The HTML source editor and the side preview are removed.

## Capabilities

### New Capabilities

### Modified Capabilities
- `learning-views`: Edit page edits the rendered text in place, instead of the HTML source.

## Impact

- Frontend only:
  - `NoteEditor.tsx` (rewritten)
  - new `lib/inlineEdit.ts`: prepare the editable copy and apply the edits
  - CSS and tests
  - the `note-edit.e2e.ts` editor tests
- No backend or API change.
