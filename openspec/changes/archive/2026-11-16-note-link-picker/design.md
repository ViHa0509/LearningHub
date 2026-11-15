# Design

## Note header

`NoteView.tsx` header, inside `.note-fields`, after the title controls:

- `<label>` text **Linked to** wrapping (or `htmlFor`) the `NodePicker`; the select's accessible name is "Linked to" (the `label` prop of `NodePicker`). Empty option stays "No node (unsorted)".
- Local state `pickedNode: string | null`, initialised from the note's link (`note.node_id` when not missing, else `null`) and reset when the note changes (`useEffect` on `note.id`, `note.node_id`, `note.node_missing`).
- `linkDirty = pickedNode !== savedNode`. While dirty: buttons **Save link** (`className="primary"`, `aria-label="Save link"`) and **Cancel link change** (`aria-label="Cancel link change"`), in a `span.title-actions` like the title's. Save calls `api.link(note.id, pickedNode)` through `run` (errors in the existing error line); Cancel sets `pickedNode` back to `savedNode`. Escape on the select cancels.
- **Open lesson**: `<a className="open-lesson" href={routeHash({ page: 'lesson', domain, node })}>Open lesson</a>` for the saved node when it exists (`note.node_id && !note.node_missing`); `domain` is the part before the first `/`, `node` the rest (the app already splits ids this way for the roadmap route). Hidden for an unsorted note and for a missing node; the "Linked node … no longer exists" tag stays.
- No leave guard for a pending link change (parity with the title field); the editor's guard is unchanged.

## Layout

The header must still fit Back, title, picker and More actions on one line at 1280 px with both panes open (`curation.e2e.ts` "one line" test). The label and the link are small inline text; the select keeps `max-width: 260px`. If room runs short, the title input may shrink before the picker wraps.

## Tests

- Vitest `NoteView.test.tsx`: selectors move to "Linked to"; "changes and removes the link" becomes: picking a node sends nothing, Save link sends the PATCH, picking the empty option and Save sends `node_id: null`; Cancel restores the value; Open lesson has the lesson href and is absent for an unsorted note and for a missing node.
- E2E `note-edit.e2e.ts`: a new test changes the link, checks no PATCH happened (API still reports the old node), Cancel restores, change + Save persists after reload, Open lesson lands on the lesson page. `curation.e2e.ts` one-line test uses the new name.
