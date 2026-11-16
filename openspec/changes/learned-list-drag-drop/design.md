# Design: drag a note onto a topic

## Decisions

1. **Native HTML5 drag and drop, no library.** One list, one kind of item, mouse only: `draggable`, `dragstart`, `dragover`, `drop`, `dragend` are enough, and Playwright's `dragTo` drives them in Edge. The browser scrolls the list while the pointer is near its edge. Touch screens do not fire these events; Move to node covers them.

2. **A drop saves at once, with Undo.** The project rule is an explicit Save for every edit and no silent save on blur or leaving. A drop is a deliberate gesture with a visible target, not a side effect of leaving a field, and Escape cancels it while dragging. A Save step after every drop would take away what the owner asked for. The risk the rule guards against (a link changed by accident, as on 2026-11-16) is covered by the Undo line, the same pattern as Archive in this list and as rename and link on the note page.

3. **Topics that have notes keep their place during a drag.** `groupNotes` gets an option `allTopics`: for each domain that is in the result, the topics without a visible note are appended after the existing ones, in roadmap order, with an empty note list. Nothing above the pointer inside a domain moves when the drag starts. Domains without any note are still left out (owner's choice).

4. **The title filter does not hide targets.** With a filter typed, the domains shown are the ones the filter leaves; during a drag each of them still lists all its topics.

## Behaviour

- `LearnedList` state `drag: { note: Note; over: string | null } | null`. `over` is a node `full_id`, or `'unsorted'`.
- Draggable: a note row of the active list that is not being renamed. Archived rows are not draggable.
- `dragstart`: `dataTransfer.setData('application/x-learninghub-note', note.id)`, `effectAllowed = 'move'`, close an open menu, then set `drag` in a `setTimeout(0)`: changing the DOM inside `dragstart` makes Chromium end the drag.
- Drop target: the whole topic group (`.node-group`, heading and its notes) and the whole Unsorted section. `dragover` calls `preventDefault()` only when `drag` is set and the target is not the note's current place, and sets `over`; the target gets the class `drop-target`. `dragleave` to outside the group clears `over`.
- `drop`: read the note from `drag` (not from `dataTransfer`, which other pages can fill), call `api.link(note.id, target)` through the existing `run`, then show the undo line. A failed call shows the existing error line and no undo line.
- `dragend` (also after Escape or a drop outside): clear `drag`.
- Undo line: one line shared with Archive (`undo` state becomes a union: archived | moved). "Moved ‘<title>’ to <topic title>." or "Moved ‘<title>’ to Unsorted.", button Undo, gone after `UNDO_MS`. Undo calls `api.link(note.id, previous)`. `previous` is the note's `node_id` before the drop, or `null` when the note had no link. For a note whose node is missing (`node_missing`) the old link cannot be saved again, so the line has no Undo button.
- An empty topic during a drag is a `.node-group` with its heading and a muted "Drop here" line; empty Unsorted likewise.
- Accessibility: the row gets no new control; the group keeps `role="group"` and its label. The undo line is `role="status"` as today.

## Tests

- `grouping.test.ts`: `allTopics` appends the empty topics in roadmap order after the ones with notes; domains without notes stay out; the filter still applies to notes.
- `LearnedList.test.tsx`: drag start shows empty topics and Unsorted; drop on another topic calls `api.link` with its id and shows the undo line; Undo links back; drop on the own topic does nothing; drop on Unsorted sends `null`; drag end removes the empty topics; a row being renamed and archived rows are not draggable; a failed link shows the error.
- e2e `curation.e2e.ts`: drag a note from Unsorted to an empty topic of a listed domain, Undo, drag to Unsorted.
