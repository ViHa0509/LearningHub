# Tasks

Contract: `design.md`. Frontend only.

## 1. Frontend

- [x] 1.1 `index.css`: `.app-loading`; `index.html`: the static indicator inside `#root`; `AppShell.tsx`: the indicator in the loading branch (design 1-4); verify with Vitest in `AppShell.test.tsx` for "While the session is being checked", "Gone once the app shows" and "Service unavailable wins", a Vitest test that reads `frontend/index.html` for "Before the app's code has loaded", `npm run lint`, `npm run build`

## 2. E2E and verification

- [x] 2.1 qc-e2e: in `e2e/app.e2e.ts`, the raw answer of `/` holds the status element with "Loading…"; with the status request delayed, the indicator is visible and then replaced by the page; with reduced motion emulated the spinner's animation is `none`; screenshots `app-loading` light and dark; `npm run e2e` passes
- [x] 2.2 Every check in `CLAUDE.md` passes and `openspec validate app-loading-indicator --strict` passes; verifier report
