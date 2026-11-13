# Tasks

## 1. Note header

- [x] 1.1 `NoteView.tsx` and `index.css`: header is one non-wrapping row of Back, a fields group (title field, title Save and Cancel, node picker, missing-node tag) and More actions; the fields group shrinks and wraps inside itself only when the pane is very narrow; the delete confirmation is a bar under the header; verify with Vitest in `NoteView.test.tsx` (confirmation is outside the header) and `npm run lint`, `npm run build`

## 2. Page loading

- [x] 2.1 `NoteView.tsx` and `index.css`: the frame sits in a wrapper with the app's background; until the frame's `load` event a `role="status"` indicator (spinner and "Loading page…") is shown and the frame is hidden; after a page save the reloaded frame shows the indicator again; no spin under `prefers-reduced-motion`; the frame keeps `sandbox="allow-scripts"`; verify with Vitest (indicator before load, gone after)

## 3. E2E and integration

- [x] 3.1 `e2e/curation.e2e.ts`: at 1280 px with both panels, Back, title, picker and More actions share one line and More actions is at the header's right end, also with the delete confirmation open; a delayed stored page shows the indicator, then the page; `e2e/responsive.e2e.ts` (phone): Back and More actions on the first line, no sideways scroll; screenshots light and dark; rerun until `npm run e2e` passes
- [ ] 3.2 Every check in `CLAUDE.md` passes and `openspec validate note-page-polish --strict` passes; verifier report (`ai-sdlc-kit:verifier`) on the change
