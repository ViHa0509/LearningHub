# Change: A loading indicator while the app starts

## Why

The owner reported (2026-11-16) that opening the hosted app shows only the empty background for a while before the page appears, with nothing to say it is loading. Two moments are blank: before the JavaScript has loaded (`index.html` holds an empty `#root`), and while the app waits for the sign-in status and the session (`AppShell` renders an empty `<main aria-busy>`), which is slow when the hosted backend starts cold. The note page already has a spinner with "Loading page…" (change `note-page-polish`); the owner wants the same here.

## What changes

- `index.html` ships a static loading indicator inside `#root` (spinner and "Loading…"), so it shows as soon as the HTML and the stylesheet arrive; the app replaces it when it renders.
- While the app waits for the sign-in status or the session, it shows the same indicator in the same place instead of an empty page.
- Same spinner as the note page; it does not spin under `prefers-reduced-motion`.

## Impact

- Modified capability spec `learning-views` (new requirement).
- Frontend only: `frontend/index.html`, `frontend/src/components/AppShell.tsx`, `frontend/src/index.css`, Vitest; e2e `app.e2e.ts`.
