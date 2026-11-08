# Learning Hub

[![CI](https://github.com/ViHa0509/LearningHub/actions/workflows/ci.yml/badge.svg)](https://github.com/ViHa0509/LearningHub/actions/workflows/ci.yml)

A personal web app that keeps what I learn in one place: research pages generated with Claude are imported as notes, placed on hand-written roadmaps per role (Frontend, Backend, DevOps, QA, Data Engineer, AI Engineer), and turned into short lessons per topic, with an agent in the side panel that answers from my own notes and drafts lessons.

It is also built as a showcase of an **AI-native SDLC**: every change goes spec -> plan -> code -> review -> verify, run by a small agent team (see [How it is built](#how-it-is-built)).

## Features

- **Home** with one card per role, its description and progress (topics with notes).
- **Roadmap maps** (React Flow) with note counts per topic; click a topic to open its lesson.
- **Lesson pages**: breadcrumb, description, subtopics, linked notes, and a Markdown lesson you write or the agent drafts.
- **Import** of Claude-generated HTML pages (duplicate detection, 10 MB limit); originals are shown in a sandboxed iframe (`sandbox="allow-scripts"`, CSP `sandbox`), so their scripts cannot reach the app.
- **AI providers and agents**: named provider configurations (OpenAI, Anthropic, Gemini, Local, Custom) with parameters, a connection test that names the failure, model listing, and a primary and fallback provider per agent.
- **Agent chat** on the configured providers: tools to search and read notes, list roadmaps, read and write lessons. Note text is treated as untrusted data; the agent never overwrites a lesson you wrote.
- Light, dark or system theme; every page has its own address (`#/lesson/backend/caching`).

## Run it

Needs Docker Desktop, Python 3.12 and Node 24+. Commands are for Git Bash on Windows, run from the repo folder.

### First time only

```bash
docker compose up -d                                  # Postgres on port 5434
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt
cp .env.example .env                                  # optional: provider keys, see below
cd ../frontend
npm install
```

### Every time

Use two terminals; each server keeps running in its own.

**Terminal 1 - database and backend** (http://localhost:8000)

```bash
docker compose up -d                                  # no-op if Postgres is already up
cd backend
.venv/Scripts/alembic upgrade head                    # applies new migrations, if any
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

**Terminal 2 - frontend** (open http://localhost:5173)

```bash
cd frontend
npm run dev
```

Stop a server with `Ctrl+C` in its terminal; `docker compose stop` stops Postgres.

After pulling new code: run `.venv/Scripts/pip install -r requirements-dev.txt` and `npm install` again if those files changed, then restart the backend (it does not reload by itself; `--reload` can hang on Windows and keep serving old code).

### If something is wrong

| You see | Do |
|---|---|
| The app shows **Service unavailable - can't reach its server** | Terminal 1 is not running the backend: start it. The page reconnects by itself. |
| **Service unavailable - can't reach its database** | Postgres is down: `docker compose up -d` (start Docker Desktop first). |
| `address already in use` on 8000 or 5173 | Another copy is running: close it (`netstat -ano \| findstr :8000`, then `taskkill /PID <pid> /F`). |
| An error about a missing table or column | Run `.venv/Scripts/alembic upgrade head` in `backend`, then restart the backend. |
| The server refuses to start with a roadmap error | A file in `roadmaps/` is invalid; the message names the file and the node. |

### First sign-in

The app has one Owner account. On the first visit it asks you to **create the owner account** (email and password, or GitHub/Google once configured); after that, sign-up is closed and every page needs a login. Optional settings in `backend/.env`:

| Setting | What it does |
|---|---|
| `LH_GITHUB_CLIENT_ID`, `LH_GITHUB_CLIENT_SECRET` | GitHub sign-in. Callback URL: `<LH_PUBLIC_URL>/api/auth/oauth/github/callback` |
| `LH_GOOGLE_CLIENT_ID`, `LH_GOOGLE_CLIENT_SECRET` | Google sign-in. Callback URL: `<LH_PUBLIC_URL>/api/auth/oauth/google/callback` |
| `LH_PUBLIC_URL` | Where the browser opens the app (default `http://localhost:5173`); used for OAuth callbacks and links in emails |
| `LH_SMTP_HOST`, `LH_SMTP_PORT`, `LH_SMTP_USER`, `LH_SMTP_PASSWORD`, `LH_SMTP_FROM` | Send emails (verification, password reset, magic link). Without them each email is written to `storage/outbox/` and the server log prints its path |
| `LH_AUTH_REQUIRED=false` | Turns the login off (only for a machine nobody else can reach) |

To enable the agent, open **Settings** (top bar) -> **Add provider**:
- Choose a type (OpenAI, Anthropic, Google Gemini, Local such as Ollama, vLLM or LM Studio, or Custom OpenAI-compatible).
- Enter a model, the API key and, for Local or Custom, a base URL. Optionally set temperature, max tokens, top p, timeout and advanced parameters.
- Press **Test Connection**, then **Save Changes**. It works at once, without a restart.

Under **Agents**, give the Learning assistant and the Lesson writer their own provider, plus an optional fallback. The fallback is used only on timeout, rate limit or unavailability. Keys are encrypted (`storage/secret.key` or `LH_SECRET_KEY`) and never shown again. Keys in `backend/.env` (`LH_ANTHROPIC_API_KEY`, ...) are imported once as "<Type> (from .env)". Chat calls are limited to 20 per minute (`LH_AGENT_RATE_PER_MINUTE`).

## Run a released version

Each release is a Docker image with the backend and the built app on one port. Only Docker is needed:

```bash
curl -LO https://github.com/ViHa0509/LearningHub/releases/latest/download/docker-compose.release.yml
docker compose -f docker-compose.release.yml up -d     # LH_VERSION=0.1.0 picks a version; default latest
```

Open http://localhost:8080 and create the owner account. Migrations run when the container starts; the database and the uploaded files (and `secret.key`) are kept in the volumes `db-data` and `app-data`. Optional settings (`LH_GITHUB_*`, `LH_GOOGLE_*`, `LH_SMTP_*`, `LH_PUBLIC_URL`) go in a `.env` file next to the compose file.

The **Claude Code** provider type needs the `claude` CLI, which is not in the image: use it from a hand-run backend (above), or use an API-key provider in the image.

### Cut a release

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The Release workflow runs every check, pushes `ghcr.io/viha0509/learninghub:0.1.0` and `:latest`, and creates a GitHub Release with generated notes and `docker-compose.release.yml`. It needs no secret beyond the default token. The first time, make the package public under GitHub -> Packages if others should pull it.

CI (`.github/workflows/ci.yml`) runs the backend, frontend and e2e checks on every push to `main` and every pull request; the e2e screenshots are kept as a run artifact for 14 days.

## Public access (Cloudflare Tunnel)

The app stays on your machine; a Cloudflare Tunnel makes it reachable at your own https address. The login must be on: with an https `LH_PUBLIC_URL` and `LH_AUTH_REQUIRED=false` the backend refuses to start.

1. Install `cloudflared` (`winget install --id Cloudflare.cloudflared`) and, in your own terminal, run `cloudflared tunnel login` (it opens the browser to pick your domain).
2. `cloudflared tunnel create learninghub` prints a tunnel id; then `cloudflared tunnel route dns learninghub hub.<your-domain>`.
3. Copy `deploy/cloudflared/config.example.yml` to `deploy/cloudflared/config.yml` (git-ignored) and fill in the tunnel id, the credentials file and the hostname.
4. Run the app on one origin: the release image (port 8080), or the backend by hand with `LH_STATIC_DIR=../frontend/dist` after `npm run build` (then point the config at port 8000).
5. Set `LH_PUBLIC_URL=https://hub.<your-domain>` (session cookies become Secure). For GitHub or Google sign-in, add the callback URLs with that address. In the image, also set `LH_FORWARDED_ALLOW_IPS=*` so the sign-in rate limit sees each visitor's address (the port is bound to 127.0.0.1 only).
6. Start the tunnel: `deploy/cloudflared/run-tunnel.ps1` (or `cloudflared tunnel --config deploy/cloudflared/config.yml run`).

What stays local: the database, the files, the provider keys and the Claude Code CLI never leave your machine; only the pages and API answers go through the tunnel.

## Checks

| What | Command |
|---|---|
| Backend tests (real Postgres) | `cd backend && .venv/Scripts/python -m pytest` |
| Backend lint and types | `ruff check . && ruff format --check . && mypy app` |
| Frontend tests, lint, build | `cd frontend && npm test && npm run lint && npm run build` |
| End-to-end UI (Edge, own DB and servers, screenshots) | `cd frontend && npm run e2e` |
| Agent evals (real provider, needs a key) | `cd backend && .venv/Scripts/python -m pytest evals -m live -v` |

`CLAUDE.md` is the source of truth for commands; agents and the verifier run exactly those.

## How it is built

- **Specs first.** Each change lives in `openspec/changes/<change>/` (proposal, delta specs, design, tasks) and is archived into `openspec/specs/` when done. Evidence of each run (checks, verifier and UI QC reports, problems found) is kept next to the change in `evidence.md`.
- **Agent team** from the [`ai-sdlc-kit`](https://github.com/ViHa0509/ai-sdlc-kit-petrus) Claude Code plugin, with the model picked per job:

| Agent | Model | Job |
|---|---|---|
| main session (orchestrator) | Opus | specs, design, security-sensitive code, final review, dispatch |
| `implementer` | Sonnet | one well-specified task, runs the checks |
| `verifier` | Sonnet | runs every check, maps tasks and scenarios to tests |
| `qc-ui` | Sonnet | runs the e2e suite and inspects every screenshot (light and dark) |
| `brainstormer` | Sonnet | proposes in-scope ideas into `ideas/BACKLOG.md` from `docs/VISION.md` |
| `scout` | Haiku | read-only lookups |

- **Loops**: `/loop 30m /ai-sdlc-kit:orchestrate` runs one cycle at a time (next tasks -> implementers -> verifier -> qc-ui -> commit), stopping when a human is needed; `/loop 12h /ai-sdlc-kit:brainstorm` keeps the idea backlog fresh. Cycles are logged in `.sdlc/log.md`.

## Layout

```
backend/    FastAPI app (app/), Alembic migrations, pytest tests, agent evals (evals/)
frontend/   Vite + React + TypeScript (src/), Vitest tests, Playwright e2e (e2e/)
roadmaps/   hand-written roadmap YAML, one file per domain
openspec/   specs and changes
docs/       VISION.md - the confirmed scope
ideas/      BACKLOG.md - ideas waiting for a decision
```
