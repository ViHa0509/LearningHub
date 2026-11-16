# Change: Drag a note onto a topic in the Learned list

## Why

The owner's "Agentic Engineer" interview note sits under Ô tô hạng B > chuong-1 (note `f16e4237…`, 2026-11-16). Putting it right means Move to node or the "Linked to" picker: a dialog and a long dropdown for something the list already shows as a tree. The owner asked to drag the note onto the right topic in the list. The list shows only topics that already have a note, so most topics cannot be a target today.

## What changes

- A note in the Learned list can be dragged with the mouse and dropped on a topic of the list; the drop links the note to that topic.
- While a note is dragged, every domain shown in the list also shows its topics that have no note yet (after the ones that have notes, in roadmap order), and the Unsorted group is shown even when it is empty. Dropping on Unsorted removes the link. The extra topics disappear when the drag ends.
- The topic under the pointer is highlighted; dropping on the note's own topic changes nothing.
- After a drop the list shows "Moved ‘<title>’ to <topic>. Undo" for a few seconds; Undo puts the previous link back.
- Move to node stays in the More actions menu: it is the way with a keyboard or a touch screen, and the way to reach a domain that has no note yet.

Owner's decision (2026-11-16): the drop targets are all topics of the domains already in the list, not every domain.

## Impact

- Spec: `learning-views` (Learned-items list).
- Frontend only: `LearnedList.tsx`, `lib/grouping.ts`, `index.css`, their Vitest files; e2e `curation.e2e.ts`.
- No backend change (`PATCH /api/notes/{id}` with `node_id` already exists), no migration, no new dependency.
