## 1. Backend

- [x] 1.1 `/api/health` runs `SELECT 1`; 503 `{status: unavailable, reason: database}` on failure; tests for both

## 2. Frontend

- [x] 2.1 `useServiceHealth` (TanStack Query: on start, every 30 s, every 5 s while down; `reportFailure()` from `api.ts` on network errors and 5xx triggers a check)
- [x] 2.2 `ServiceUnavailable` page (brand mark, reason, reconnect note, last checked; no retry button or countdown) in `AppShell` instead of the panels; top bar stays; on recovery invalidate all queries
- [x] 2.3 Reword the "Is the backend running?" messages; CSS on tokens (light and dark)
- [x] 2.4 Vitest for every scenario

## 3. E2E

- [x] 3.1 qc-e2e: dead backend (route `/api/**` to abort), no retry controls, background recovery on the same page; loop until the suite passes
