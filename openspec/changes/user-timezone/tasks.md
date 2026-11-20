# Tasks

## 1. Backend

- [x] 1.1 Migration and model: `users.timezone` (main session; check: the migration test for it)
- [x] 1.2 `MeOut.timezone`, `PUT /api/auth/timezone` with validation, `tzdata` in the requirements; tests for the backend side of every scenario (check: backend tests, lint, types)

## 2. Frontend

- [x] 2.1 `lib/time.ts` and every timestamp in the UI moved to it; Vitest for the chosen zone and the fallback (check: frontend tests, lint, build)
- [x] 2.2 Sign-in dialog and the Settings -> Account field; `fakeApi.ts` default user has a zone; Vitest for every scenario (check: frontend tests, lint, build)

## 3. Quality

- [x] 3.1 `qc-e2e`: `owner.setup.ts` sets the owner's zone; Playwright tests from the spec with a fresh member, light and dark screenshots, phone size for the dialog; full e2e passes (check: `cd frontend && npm run e2e`)
- [x] 3.2 `verifier` report for the change: pass
