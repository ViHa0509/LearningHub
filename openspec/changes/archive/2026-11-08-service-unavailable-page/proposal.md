## Why

When the backend or its database is down, the app shows bare red lines such as "Could not load roadmaps. Is the backend running?" in several places, and the user has to reload by hand once the service is back. A single, calm "service unavailable" page that retries on its own is clearer.

## What Changes

- `GET /api/health` also checks the database with `SELECT 1`.
  - Answers 200 `{"status": "ok"}` when the database answers.
  - Answers 503 `{"status": "unavailable", "reason": "database"}` when it does not, so a backend that is up but cannot reach Postgres counts as unavailable too.
- The frontend checks `/api/health`:
  - when the app starts
  - every 30 s
  - right after any API request fails with a network error or a 5xx answer
- While the check fails, the center and side panels are replaced by a full-page **Service unavailable** screen:
  - the brand mark, a short explanation ("Learning Hub can't reach its server" / "…its database")
  - "This page reconnects on its own." and the time it was last checked; no retry button or countdown (it checks again every 5 s in the background)
  - the top bar with the theme switch stays
- When the check passes again, the page goes away, every query is refetched, and the user stays on the page they were on.
- The scattered "Is the backend running?" messages are reworded to plain failures ("Could not load roadmaps.") because the outage page now covers that case.

## Capabilities

### New Capabilities

### Modified Capabilities
- `learning-views`: new requirement "Service unavailable page".

## Impact

- Backend: `app/main.py` (health checks the DB) plus a test.
- Frontend: new `hooks` entry `useServiceHealth`, new `ServiceUnavailable.tsx`, `AppShell.tsx`, `api.ts` (report failures), CSS on tokens, Vitest.
- E2E: a test that points the app at a dead backend (route `/api/**` to fail) and checks the page, the retry and the recovery.
