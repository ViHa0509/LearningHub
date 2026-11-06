# Learning Hub

A personal web app that keeps what I learn in one place: research pages generated with Claude are imported as notes, placed on hand-written roadmaps per role (Frontend, Backend, DevOps, QA, Data Engineer), and turned into short lessons per topic, with an agent in the side panel that answers from my own notes and drafts lessons.

It is also built as a showcase of an **AI-native SDLC**: every change goes spec -> plan -> code -> review -> verify, run by a small agent team (see [How it is built](#how-it-is-built)).

## Features

- **Home** with one card per role, its description and progress (topics with notes).
- **Roadmap maps** (React Flow) with note counts per topic; click a topic to open its lesson.
- **Lesson pages**: breadcrumb, description, subtopics, linked notes, and a Markdown lesson you write or the agent drafts.
- **Import** of Claude-generated HTML pages (duplicate detection, 10 MB limit); originals are shown in a sandboxed iframe (`sandbox="allow-scripts"`, CSP `sandbox`), so their scripts cannot reach the app.
- **Agent chat** with Anthropic, OpenAI, DeepSeek or a local Ollama model (Gemma): tools to search and read notes, list roadmaps, read and write lessons. Note text is treated as untrusted data; the agent never overwrites a lesson you wrote.
- Light, dark or system theme; every page has its own address (`#/lesson/backend/caching`).

## Run it

Needs Docker, Python 3.12 and Node 24+ (Windows paths shown; Git Bash).

```bash
docker compose up -d                                   # Postgres on port 5434
cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt
.venv/Scripts/alembic upgrade head
.venv/Scripts/python -m uvicorn app.main:app --port 8000
cd frontend && npm install && npm run dev              # http://localhost:5173
```

To enable the agent, put at least one key in `backend/.env` and restart the backend:

```
LH_ANTHROPIC_API_KEY=...        # or LH_OPENAI_API_KEY, LH_DEEPSEEK_API_KEY, LH_OLLAMA_URL=http://localhost:11434
```

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
