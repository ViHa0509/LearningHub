## 1. App

- [ ] 1.1 `LH_STATIC_DIR`: serve the built frontend (index.html fallback for non-API paths); tests
- [ ] 1.2 `playwright.config.ts`: venv Python path per platform

## 2. CI

- [ ] 2.1 `.github/workflows/ci.yml`: backend (Postgres service, init SQL, pytest, ruff, mypy), frontend (npm ci, test, lint, build), e2e (Edge, artifacts), concurrency
- [ ] 2.2 Push and confirm the run is green on GitHub (fix what only fails on Linux)

## 3. CD

- [ ] 3.1 `Dockerfile` (frontend build stage, Python slim runtime), `.dockerignore`, `docker/entrypoint.sh` (migrate then serve), `docker-compose.release.yml`
- [ ] 3.2 `.github/workflows/release.yml` on `v*`: checks, build and push to GHCR, GitHub Release with notes and the compose file
- [ ] 3.3 README: CI badge, cutting a release, running a release (the Claude Code provider needs the CLI outside the image)

## 4. Public access (Cloudflare Tunnel; after owner-auth is on)

- [ ] 4.1 `deploy/cloudflared/config.example.yml` (named tunnel to the app on one origin: the release image on 8080, or the dev proxy on 5173) and a start script; the app refuses to start publicly when `LH_PUBLIC_URL` is https but `LH_AUTH_REQUIRED` is off
- [ ] 4.2 README: create the tunnel (`cloudflared tunnel login` by the owner, in a terminal), DNS route, set `LH_PUBLIC_URL`, OAuth callback URLs for the public address, and what stays local (Claude Code CLI on the owner's machine)
