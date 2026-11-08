## Why

Every check (backend tests, lint, types, frontend tests, build, the Playwright suite) runs only on the owner's Windows machine. Nothing stops a broken commit on `main`, and there is no packaged way to run a released version. The owner asked for CI/CD.

## What Changes

- **CI:** GitHub Actions workflow `.github/workflows/ci.yml`, on every push to `main` and every pull request (the `pull_request` trigger also lets the checks be required by branch protection later). Jobs on `ubuntu-latest`:
  - **backend:**
    - Postgres service `pgvector/pgvector:pg17` on port 5434, with `docker/db-init/01-test-db.sql` applied (creates `learninghub_test` and `learninghub_e2e`)
    - Python 3.12 with a pip cache
    - `pytest`, `ruff check`, `ruff format --check`, `mypy app`
  - **frontend:** Node 24 with an npm cache; `npm ci`, `npm test`, `npm run lint`, `npm run build`.
  - **e2e** (after the backend and frontend jobs):
    - the same Postgres service, then the backend venv and `npm ci`
    - Playwright Edge (`npx playwright install --with-deps msedge`)
    - `npm run e2e`, with the fake LLM, fake `claude`, fake feeds and fake reference source as today
    - uploads the screenshots and the report as an artifact (kept 14 days)
  - Concurrency: a newer push cancels an older run on the same branch.
- **Portable e2e config:** `playwright.config.ts` picks the venv Python by platform (`.venv/Scripts/python` on Windows, `.venv/bin/python` elsewhere). The browser channel stays Edge on both.
- **CD:** workflow `.github/workflows/release.yml`, on a pushed tag `v*`:
  - runs the same checks
  - builds one Docker image `ghcr.io/viha0509/learninghub:<version>` (and `:latest`): a multi-stage `Dockerfile` that builds the frontend, then a Python slim image with the backend serving the built frontend
  - pushes it to GitHub Container Registry with `GITHUB_TOKEN`
  - creates a GitHub Release with generated notes and the compose file attached
- **Running a release:** `docker-compose.release.yml` runs Postgres plus the app image on http://localhost:8080. Migrations run when the container starts, and the storage and database are kept in volumes.
  - The backend serves the frontend's built files when `LH_STATIC_DIR` is set: unknown non-API paths return `index.html`, and `/api` routes are unchanged.
  - The Claude Code provider needs the `claude` CLI, which is not in the image; the README says so.
- **README:** a CI badge, how to cut a release (`git tag v0.1.0 && git push origin v0.1.0`), and how to run the released image.

## Capabilities

### New Capabilities
- `delivery`: CI checks on GitHub, release images and running a release.

### Modified Capabilities

## Impact

- New: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `Dockerfile`, `.dockerignore`, `docker-compose.release.yml`, `docker/entrypoint.sh`.
- Changed:
  - `frontend/playwright.config.ts` (Python path)
  - `backend/app/main.py` (optional static files, with a test)
  - `backend/app/config.py` (`static_dir`)
  - README
- No secrets are needed beyond the default `GITHUB_TOKEN` (`packages: write` on the release workflow only).
