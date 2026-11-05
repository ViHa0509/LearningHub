# Tasks

## 1. Repository scaffolding and Kit v0 adoption

- [x] 1.1 Add `.gitattributes` (`* text=auto eol=lf`) and extend `.gitignore` for `storage/`, verify `git check-ignore storage/blobs/x.html` matches
- [x] 1.2 Add `docker-compose.yml` with Postgres (`pgvector/pgvector:pg17`), a dev and a test database, and verify `docker compose up -d` reports the service healthy
- [x] 1.3 Scaffold `backend/` (FastAPI app, `requirements.txt`, `requirements-dev.txt`, ruff and mypy config, settings from `.env` with `.env.example`) and verify `GET /api/health` returns 200 under `uvicorn`
- [x] 1.4 Scaffold `frontend/` (Vite + React + TypeScript, oxlint, Vitest, `/api` proxy to port 8000) and verify `npm run build` and `npm test` succeed
- [x] 1.5 Install Kit v0 from `ai-sdlc-kit-petrus`: add `CLAUDE.md` (run, test, lint commands for both parts), `REVIEW.md` and the verifier subagent, and verify the verifier runs the documented checks on the empty scaffold

## 2. Roadmap catalog (spec: roadmap-catalog)

- [x] 2.1 Write `roadmaps/backend.yaml` and `roadmaps/devops.yaml` by hand, 15-25 nodes each, and verify each node id is kebab-case and unique by running the loader
- [x] 2.2 Implement YAML loading and validation (missing fields, duplicates, non-kebab ids, unknown parent, cycles) that stops startup with file and node in the error, and verify with table-driven pytest cases for each invalid kind
- [x] 2.3 Implement `GET /api/domains` and `GET /api/domains/{domain}/roadmap` (404 for unknown domain) and verify with API tests covering every roadmap-catalog scenario

## 3. Note storage and import (spec: knowledge-import)

- [x] 3.1 Create the `notes` table with an Alembic migration and verify `alembic upgrade head` then `alembic downgrade base` both succeed on the test database
- [x] 3.2 Implement the `FileStore` protocol and `LocalFileStore` (content-addressed under `storage/blobs/`) and verify put/get/delete round-trip tests, including byte-identical reads
- [x] 3.3 Implement HTML extraction (title fallback chain, text without scripts/styles, charset fallback) and verify with fixture Claude pages under `backend/tests/fixtures/`
- [x] 3.4 Implement `POST /api/notes/import` for many files with per-file outcome (created, duplicate, rejected with reason; 10 MB limit) and verify API tests for each knowledge-import import and rejection scenario
- [x] 3.5 Implement list, read, rename and delete (`GET/PATCH/DELETE /api/notes...`; delete also removes the blob) and verify API tests for rename and delete scenarios
- [x] 3.6 Implement `GET /api/notes/{id}/original` with `Content-Security-Policy: sandbox allow-scripts` and `nosniff` and verify a test asserts the headers and byte-identical body

## 4. Node linking (spec: node-linking)

- [x] 4.1 Extend `PATCH /api/notes/{id}` to set, change or clear `node_id`, rejecting unknown nodes without changing the note, and verify API tests for link, move, unlink and unknown-node scenarios
- [x] 4.2 Implement `GET /api/notes?node=` and `?unsorted=true` (unsorted includes notes on missing nodes, flagged) and verify API tests including the removed-node scenario
- [x] 4.3 Implement `GET /api/domains/{domain}/counts` and verify the per-domain count scenario

## 5. Web views (spec: learning-views)

- [x] 5.1 Build the three-pane layout with collapsible left and right panels and the "agent not available yet" placeholder, and verify a Vitest test for collapse and expand
- [x] 5.2 Build the left learned-items list (grouped by domain and node in roadmap order, Unsorted group, title filter, empty state with import button) and verify Vitest tests for grouping, filtering and empty state
- [x] 5.3 Build the center map with React Flow and a roadmap-style spine layout, note-count markers and a domain switcher, and verify a Vitest test that marked nodes match the counts API response
- [x] 5.4 Wire two-way selection between list and map and verify Vitest tests for both list-to-map and map-to-list scenarios
- [x] 5.5 Build import from the UI (pick or drop many files, per-file outcome, optional node picker) and verify a Vitest test for import-and-link and skip-linking flows against a mocked API
- [x] 5.6 Build the note view (title, sandboxed iframe with `sandbox="allow-scripts"`, rename, relink, unlink, delete with confirmation) and verify Vitest tests that the iframe has no `allow-same-origin` and delete requires confirmation

## 6. End-to-end check

- [x] 6.1 Run the full flow against the real backend and database: import three real Claude research files, link two, leave one unsorted, reload the app, and verify the list, map counts and original pages match; record the result in the change's evidence log
- [x] 6.2 Run all checks listed in CLAUDE.md (ruff, mypy, pytest, oxlint, tsc, Vitest) and the verifier subagent, and verify everything passes with the verifier report recorded in evidence.md (no PR flow yet: work is pushed to main)

## Workflow follow-up

- Review the PR against REVIEW.md, then archive the change with `/opsx:archive` once merged.
- Save the evidence log entries (what failed, what was fixed, which check caught it) to KH project `learning-hub`.
