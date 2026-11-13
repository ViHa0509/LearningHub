# Proposal

## Why

Two rough edges on the note page, reported by the owner after `note-actions-menu` shipped:

- With both side panels open on a laptop-size window the note header wraps, and the More actions button drops to a second line. On a large screen it sits at the right end of the first line; it should stay there at every width.
- Opening a note from the learned list shows a blank white area until the stored page has loaded. On the hosted copy this takes a noticeable moment.

## What Changes

- The note header keeps Back at the left and More actions at the right end of its first line at every width. The title field and the node picker share the space between them and shrink before anything wraps; on a very narrow pane (phone) the picker moves under the title, between the two buttons.
- The delete confirmation moves out of the header row into its own bar directly under the header, so it cannot push the header onto a second line.
- While the stored page loads, the page area keeps the app's background and shows a spinner with the text "Loading page…"; the frame is shown when its page has loaded. With reduced motion the spinner does not turn.

Not in this change: the page editor's own loading text, the lesson page, the learned list.

## Capabilities

### New Capabilities

### Modified Capabilities
- `learning-views`: new requirement "Note page header and page loading" (header stays on one line; loading indicator while the stored page loads).

## Impact

- Frontend only: `components/NoteView.tsx`, `index.css`.
- Tests: `NoteView.test.tsx`, `e2e/curation.e2e.ts`, `e2e/responsive.e2e.ts`.
- No backend, API or data change. The frame keeps `sandbox="allow-scripts"` without `allow-same-origin`.
