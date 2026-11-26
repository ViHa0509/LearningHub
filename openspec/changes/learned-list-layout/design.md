# Design

## 1. One list of groups

`groupNotes` returns `groups: ListGroup[]` in place of `domains` and `unsorted`:
`{ kind: 'domain', domainId, title, nodes } | { kind: 'category', category: string, notes } | { kind: 'unsorted', notes }`.
Domain and category groups are sorted together by their newest note (stable; ties keep domains first in roadmap order). The `unsorted` group (no valid link, no category) is last and present only when it has notes. With `allTopics` (drag) the unsorted group is always present, possibly empty, as the "no topic" drop target.

A note without a topic but with a category shows under its category group. Dropping a note on Unsorted removes its topic as before; its category is kept, so it shows under that category group if it has one.

A category named like a domain title stays a separate group (no merge).

## 2. Menus

- Category heading: `<h3>` with the name, plus a `button.group-more` "⋯" (`aria-label="More actions for group NAME"`) that opens the existing `ActionMenu` with one item, Rename. Same hover, focus and touch visibility rules as `.note-more`. Rename opens the existing inline form (Save, Cancel, Escape, same validation).
- Toolbar: a "⋯" button (`aria-label="List actions"`) after Import opens an `ActionMenu` with **Group with AI** (its `title` keeps the explanation). The button is present when at least one note has no topic. While grouping, the item is disabled and reads "Grouping…"; errors show in the list's error line as before.

## 3. Resizable panes

- Not on phones (drawers). On tablet and desktop, an open side panel has a `role="separator"` handle on its inner edge (`aria-orientation="vertical"`, `aria-label` "Resize Learned list" or "Resize Agent panel", `aria-valuenow`, `aria-valuemin`, `aria-valuemax` in px, `tabIndex=0`): a 6 px hit area, a visible line on hover and focus, `cursor: col-resize`.
- Pointer drag with pointer capture sets the width; ArrowLeft and ArrowRight change it by 16 px; Home and End go to min and max; a double-click resets the default.
- Limits: left 200-480 px, right 280-640 px, and the center never narrower than 360 px (the dragged panel is clamped). The default is today's (`minmax(240px, 22%)` and `minmax(300px, 30%)`) until the user resizes; then the column is a px width.
- Saved in `localStorage` key `lh.paneWidths` = `{left, right}`; every read and write in try/catch; the default when missing or invalid. Collapsing keeps the width for the next expand. The grid transition is off while dragging.
- The tablet rule "one side panel at a time" stays.
