# CLAUDE.md

## Project

Learning Hub is a personal web app that keeps research done with Claude (standalone HTML pages) on hand-written learning roadmaps, so past learning is found by where it sits in a domain. Single local user. Correctness and safe handling of untrusted HTML matter more than speed. It is also built as a showcase of an AI-native SDLC: every change goes spec -> plan -> code -> review -> verify.

## Commands

Agents and the verifier run exactly these commands to decide whether work is done.
Rows with `yes` in **Check?** are checks; the verifier runs every check and nothing else.
Shell: Git Bash on Windows. Postgres must be up (`docker compose up -d`) before backend tests.

| Purpose | Command | Check? |
|---|---|---|
| Start database | `docker compose up -d` | no |
| Install backend | `cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt` | no |
| Migrate dev DB | `cd backend && .venv/Scripts/alembic upgrade head` | no |
| Run backend | `cd backend && .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000` | no |
| Backend tests | `cd backend && .venv/Scripts/python -m pytest` | yes |
| Backend lint | `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .` | yes |
| Backend types | `cd backend && .venv/Scripts/mypy app` | yes |
| Install frontend | `cd frontend && npm install` | no |
| Run frontend | `cd frontend && npm run dev` (http://localhost:5173, proxies `/api`) | no |
| Frontend tests | `cd frontend && npm test` | yes |
| Frontend lint | `cd frontend && npm run lint` | yes |
| Frontend build + types | `cd frontend && npm run build` | yes |
| Format backend | `cd backend && .venv/Scripts/ruff format .` | no |

## Layout

- `backend/` - FastAPI app (`app/`), Alembic migrations (`alembic/`), pytest tests (`tests/`).
- `frontend/` - Vite + React + TypeScript app (`src/`), Vitest tests next to components.
- `roadmaps/` - hand-written roadmap YAML, one file per domain; the only source of roadmap truth.
- `storage/` - uploaded original files (git-ignored).
- `docker-compose.yml` - Postgres (host port 5434); `docker/db-init/` creates `learninghub_test`.
- `openspec/` - specs and changes; read the active change before coding.

## Conventions

- English for code, comments, UI strings and commit messages.
- Backend: sync SQLAlchemy sessions and plain `def` routes (async psycopg does not work on Windows' default loop).
- Never edit an applied Alembic migration; add a new one.
- Tests use the `learninghub_test` database and a temporary storage folder, never dev data.
- Untrusted HTML is only ever shown in `<iframe sandbox="allow-scripts">` without `allow-same-origin`, served with `Content-Security-Policy: sandbox allow-scripts`.
- Node ids are `domain/node`, lowercase kebab-case.

## Workflow

- Every change starts as an OpenSpec change: `/opsx:propose` -> review -> `/opsx:apply`.
- Work only on tasks in `openspec/changes/<change>/tasks.md`; mark a task `[x]` only when its check passes.
- A behavior the specs do not describe is new scope: update the change's artifacts first.
- Before a PR, run the verifier subagent (`ai-sdlc-kit:verifier`) on the change and paste its report into the PR.
- Never weaken or delete a test to make it pass.

## Definition of done

- [ ] Every command marked as a check in Commands passes.
- [ ] The tasks for this work are checked in the change's `tasks.md`.
- [ ] Every spec scenario touched by this work has a test.
- [ ] The verifier report is attached to the PR.

## Known mistakes

<!-- One line per mistake an agent really made here: date - mistake - rule that prevents it.
     Add a line when the same mistake happens a second time. -->
