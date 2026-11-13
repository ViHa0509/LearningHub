# Proposal

## Why

The note page header shows Edit page, Export PDF, Archive and Delete as four separate buttons next to Back, the title and the node picker. The row is crowded and wraps on narrower widths; these are occasional actions and do not need to be visible all the time.

## What Changes

- The four actions move into one **More actions** button (three vertical dots) at the right end of the note header. Pressing it opens a popup menu with Edit page, Export PDF, Archive (Restore for an archived note) and, after a divider, Delete in the danger colour.
- The menu behaves like the note menu of the learned list: focus moves to the first item, Up and Down move between items, Escape or a click outside closes it and focus returns to the button, choosing an item closes it.
- Nothing about the actions themselves changes: Edit page opens the in-place editor, Export PDF opens the print view in a new tab, Archive and Restore act at once, Delete still asks for confirmation in the header before deleting.
- While the page editor is open the menu holds only Archive or Restore and Delete, as the header does today.
- The menu behaviour (focus, keys, outside click) moves out of `LearnedList.tsx` into one shared menu component used by both places; the learned list looks and works as before.

Not in this change: the lesson page's Export PDF button, the title field, the node picker, the archived banner with its Restore button.

## Capabilities

### New Capabilities

### Modified Capabilities
- `learning-views`: "Read a note" - edit page, export PDF, archive or restore, and delete are reached through a More actions menu on the note page.

## Impact

- Frontend only: `components/NoteView.tsx`, new `components/ActionMenu.tsx` (taken from `NoteMenu` in `LearnedList.tsx`), `components/Icon.tsx` (a vertical three-dot icon if the existing `more` icon is horizontal), `index.css` (`.note-actions`, menu divider and danger item, 40 px touch height on phone and tablet).
- Tests that find these controls as header buttons change to open the menu first, without losing a check: `NoteView.test.tsx`, `e2e/curation.e2e.ts`, `e2e/note-edit.e2e.ts`, `e2e/lesson-pdf.e2e.ts` (the note's Export PDF link), `e2e/responsive.e2e.ts` if it measures these buttons.
- No backend, API or data change.
