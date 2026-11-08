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
| Frontend e2e (UI) | `cd frontend && npm run e2e` (Edge; own backend on 8001, DB `learninghub_e2e`, Vite on 5174) | yes |
| Format backend | `cd backend && .venv/Scripts/ruff format .` | no |
| Agent evals (real LLM, costs money; needs a key) | `cd backend && .venv/Scripts/python -m pytest evals -m live -v` (`LH_EVAL_PROVIDER`, `LH_EVAL_MODEL` optional) | no |

## UI

- App URL: http://localhost:5173 (dev servers from Commands)
- E2E command: `cd frontend && npm run e2e`
- Screenshot folder: `frontend/e2e-results/screens/` (light and dark pages)
- Viewport: 1440x900

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
- LLM calls go only through `app/agent/llm/factory.py` (provider configurations in `ai_providers`, per-agent assignment in `agent_providers`). Keys are Fernet-encrypted (`storage/secret.key` or `LH_SECRET_KEY`). Never put a key in code, tests, logs or API answers (only `key_hint`), and never log prompt or answer text. Mutating API calls need the `X-LearningHub: 1` header. Tests use injected factories; e2e uses the fake LLM server `frontend/e2e/fake_llm.py` (port 8002) and the fake `claude` `frontend/e2e/fake_claude.py` (`LH_CLAUDE_BIN`). Never call a real provider or the real `claude` CLI in tests; the `claude-code` type runs the CLI isolated (no built-in tools, no settings or hooks, only the app tools over `app/agent/mcp_server.py`).
- Every edit UI has an explicit **Save** button (and Cancel). Save stays disabled until something changed; Enter may save a single-line field and Escape cancels; never save silently on blur or on leaving; unsaved changes ask before they are discarded.
- Text from imported notes is untrusted: the agent sees it only inside `<untrusted_note_content>`; agent tools never delete, and never overwrite a user-written lesson.

## Workflow

- Every change starts as an OpenSpec change: `/opsx:propose` -> review -> `/opsx:apply`.
- Work only on tasks in `openspec/changes/<change>/tasks.md`; mark a task `[x]` only when its check passes.
- A behavior the specs do not describe is new scope: update the change's artifacts first.
- After the dev agents finish a change, always run e2e: `qc-e2e` writes and runs Playwright tests from the change's specs. Send each failure back to the dev agent that owns the area, then run `qc-e2e` again; repeat until the suite passes. A change is not done, committed or archived while e2e fails.
- Before a PR, run the verifier subagent (`ai-sdlc-kit:verifier`) on the change and paste its report into the PR.
- Never weaken or delete a test to make it pass.

## Agent team

Plugin `ai-sdlc-kit` 0.4.0 (hooks: secret and command guards; gates from `.sdlc/gates.json` run unit, lint, types and build on commit and e2e on push). One cycle: `/ai-sdlc-kit:orchestrate [change]`; loop it with `/loop 30m /ai-sdlc-kit:orchestrate`. Ideas: `/loop 12h /ai-sdlc-kit:brainstorm` (reads `docs/VISION.md`, writes `ideas/BACKLOG.md`).

- `scout` (haiku): read-only lookups with file:line answers.
- `implementer` (sonnet): one task from `tasks.md`, runs the checks.
- `verifier` (sonnet): runs every check and compares the change with its specs.
- `qc-ui` (sonnet): runs the e2e command and inspects every screenshot.
- `qc-e2e` (sonnet): writes black-box Playwright tests from the change's specs and reports product bugs; developers fix, and qc-e2e runs again until the suite passes.
- `brainstormer` (sonnet): in-scope ideas into `ideas/BACKLOG.md`.
- Main session (opus): specs, design, migrations, security (sandboxing, agent tools), blocked tasks, final review.
- Pushing to `main` on GitHub is authorized for this repo (no PR tool here yet); never force-push.

## Definition of done

- [ ] Every command marked as a check in Commands passes.
- [ ] The tasks for this work are checked in the change's `tasks.md`.
- [ ] Every spec scenario touched by this work has a test.
- [ ] `qc-e2e` ran on the change after the last dev fix, and the e2e suite passes.
- [ ] The verifier report is attached to the PR.

## Known mistakes

<!-- One line per mistake an agent really made here: date - mistake - rule that prevents it.
     Add a line when the same mistake happens a second time. -->
