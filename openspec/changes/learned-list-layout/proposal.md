## Why

The owner asked (2026-11-26, with a screenshot of the Learned list):
1. Merge Unsorted into the Learned list instead of a separate UNSORTED section.
2. Make the buttons behave like the rest of the list: a "⋯" menu for more actions instead of buttons always shown (Group with AI, Rename on every group).
3. Let the user change the width of the three panes instead of fixed widths.

## What Changes

- The category groups of notes without a topic become top-level groups of the Learned list, next to the domain groups, headed like a domain. Domains and categories are ordered together by their newest note. Notes without a topic and without a category are in an **Unsorted** group, always last.
- No separate UNSORTED section and heading any more. While a note is dragged, the Unsorted group shows (also when empty) as the "no topic" drop target, as before.
- Each category heading has a "⋯" (More actions for group NAME) menu with **Rename**, shown on hover or focus like a note's "⋯" (always visible on touch screens). Rename keeps its inline form with Save and Cancel.
- **Group with AI** moves into a "⋯" (List actions) menu in the list toolbar, next to Import. It is there when at least one note has no topic; while it runs the item is disabled and reads "Grouping…".
- Desktop and tablet: a drag handle on the inner edge of each open side panel resizes it; the center takes the rest. Arrow keys on the focused handle resize too, and a double-click resets the default width. Widths are kept per browser and survive a reload. Phones keep the drawers, no handles.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `learning-views`: Learned-items list, Unsorted is grouped by category, Group unsorted notes with AI, Rename a category group, Three-pane layout.

## Impact

- Frontend only: `lib/grouping.ts`, `LearnedList.tsx`, `AppShell.tsx` (column widths, handles), `index.css`, and the Vitest and e2e tests that look for the UNSORTED section, the Group with AI button or the Rename group buttons.
- No backend, API or migration change.
