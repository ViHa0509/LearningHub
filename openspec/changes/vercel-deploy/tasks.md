# Tasks

## 1. Vercel project skeleton (settles the unconfirmed platform details first)

- [x] 1.1 Add `vercel.json` (services `web` and `api`, top-level rewrites, region `icn1`, Git deploy for `main` off), `backend/_data/` in `.gitignore`, and `LH_SERVERLESS` in `config.py` with the startup check (serverless + local storage refuses to start); verify with backend tests for the check and `openspec validate vercel-deploy --strict`
- [ ] 1.2 Owner + main session: first preview deploy from a branch with throwaway preview values; confirm the entrypoint form, the SPA fallback, the `buildCommand` copy of `roadmaps/` and `news/`, and the framework preset; record each result in `design.md` (replace "To confirm" with what worked) and apply the fallback where needed; verify `/`, a deep link and `/api/health` answer on the preview address

## 2. Database and migrations

- [x] 2.1 `make_engine`: `NullPool` and `prepare_threshold=None` in serverless mode, unchanged otherwise; verify with tests on the engine options for both modes
- [x] 2.2 Alembic migration adding `oauth_pending` and `sync_uploads` (RLS ends on, as `alembic/env.py` enforces) and their models in `db.py`; verify `alembic upgrade head` on the dev database and the existing migration tests
- [x] 2.3 `ci.yml`: `deploy` job on pushes to `main` after the checks (migrate with `LH_MIGRATE_DATABASE_URL`, then POST the deploy hook; skipped without the secrets); verify the workflow file with `actionlint` or a dry run on a branch, and that a failing migrate step fails the job

## 3. Sign-in

- [x] 3.1 `PendingStore` on the database (hashed key, encrypted verifier, single-use delete, expiry, 1000-row cap); `main.py` wiring; verify with tests for: callback through a second `PendingStore` instance, used twice, too old, cap
- [x] 3.2 `GET /api/auth/status` answers `max_upload_bytes`; verify with a route test

## 4. Data sync

- [x] 4.1 Upload parts in the file store with a `sync_uploads` row (start, part, finish, cleanup after 24 hours, owner check answering 404); verify with tests: parts through two app instances sharing a store, missing part, wrong checksum, another user's upload, no part left after finish or failure
- [x] 4.2 Sender: 4 MB parts and a 300 s finish timeout; verify with the mock-transport tests (a 10 MB backup goes in three parts, none over 4 MB)
- [x] 4.3 Session-authenticated restore upload routes sharing the part code, REPLACE checked at finish, sync key refused; remove `POST /api/data/restore`; "too large for this server" when the archive exceeds the free temp space; verify with route tests for each scenario in `specs/data-sync`
- [x] 4.4 Data & sync page: restore in 4 MB parts with progress, SHA-256 in the browser, failure message; Save/Cancel rules unchanged; verify with Vitest (progress, interrupted upload, success counts)

## 5. Uploads and large answers

- [x] 5.1 Import dialog and lesson PDF import: read the limit, refuse larger files before sending with "larger than N MB", one request per note file with merged outcomes; verify with Vitest for both `specs/knowledge-import` scenarios added here
- [x] 5.2 Server reason uses the configured limit ("larger than 4 MB" with a 4 MB setting); verify with a route test
- [x] 5.3 Stream the note file answer and the backup download, keeping the sandbox CSP, nosniff and file name headers; verify with tests on headers and on a body larger than 5 MB

## 6. Jobs

- [x] 6.1 News refresh: inline run in serverless mode, final status saved in `app_settings`, status and list reads fall back to the saved status; verify with tests (finished status in the POST answer, status read from a second app instance, one failing source)
- [x] 6.2 Reference sync: the same for `SyncJobs` per domain; verify with tests (done and failed status read from a second app instance, old links kept on failure)

## 7. Ops and documentation

- [x] 7.1 README "Run on Vercel": owner steps, the environment table, the two GitHub secrets, pooler ports (6543 for the app, 5432 for migrations), limits (4 MB uploads, restore size, per-instance rate limits, no Claude Code provider, Hobby terms), switching the Worker origin; remove `render.yaml` and the Render section; verify every command in the section runs as written
- [x] 7.2 `render-deploy` change: remove the "Run on Render" requirement and task 3.2; verify `openspec validate render-deploy --strict`
- [ ] 7.3 Confirm which forwarded-address header reaches the app behind the Worker and Vercel and that the auth rate limit and session list use it; verify with a test on the header handling and a check on the preview deploy
- [ ] 7.4 Save the Vercel deploy how-to and the confirmed platform details to KH (project `learning-hub`); verify the row reads back

## 8. Integration

- [x] 8.1 Every check in CLAUDE.md passes; `qc-e2e` writes and runs tests for the changed flows (browser restore in parts, import limit, GitHub sign-in on the fake provider) and the e2e suite passes
- [ ] 8.2 Owner + main session: production values in Vercel, GitHub secrets, push to `main`; verify CI migrates then deploys, `/api/health` is ok on the `vercel.app` address, and a second request after 20 idle minutes answers within a few seconds
- [ ] 8.3 Point the Worker at Vercel; verify on the public address: sign in with password and with GitHub, import a note and open it, news refresh, Sync from Local, restore a downloaded backup
- [ ] 8.4 Verifier report (`ai-sdlc-kit:verifier`) on the change

## Workflow follow-up

- Owner deletes the Render service after 8.3 passes.
- Archive `vercel-deploy` (and `render-deploy`) after the verifier report.
