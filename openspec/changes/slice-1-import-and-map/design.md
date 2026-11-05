# Design

## Context

The repository holds only OpenSpec setup; there is no application code yet. See proposal.md (Why) for motivation and the four specs for required behavior. Constraints that shape this design:

- Stack is fixed: React frontend, FastAPI backend, Postgres.
- Single local user, Windows development machine (Docker, Node 26, Python 3.12 available; no `uv`).
- File storage must be local now and replaceable by a cloud store later.
- Later slices add LLM classification, an agent with retrieval over notes, and multiple providers; this slice must not block them.
- This is the first change built through the AI-native loop, so every part needs a fast, deterministic feedback loop (tests, type checks, lint) an agent can run.

## Goals / Non-Goals

**Goals:**
- One repo, three top-level parts (`backend/`, `frontend/`, `roadmaps/`) with one command each to run and to test.
- A data model that later slices extend (embeddings, summaries, chat history) without reshaping notes.
- Safe display of untrusted HTML from day one.

**Non-Goals:**
- Production deployment, containers for the app itself, CI pipelines (Kit v0 adds the first CI later).
- Full-text search, embeddings, or any ranking beyond the title filter.
- Multi-user data separation.

## Decisions

### Repository layout

```
LearningHub/
  backend/        FastAPI app, Alembic migrations, pytest tests
  frontend/       Vite + React + TypeScript app, Vitest tests
  roadmaps/       backend.yaml, devops.yaml (hand-written)
  storage/        local blobs (git-ignored)
  docker-compose.yml   Postgres only
  openspec/  CLAUDE.md  REVIEW.md
```

Alternative: separate backend and frontend repos. Rejected: one feature touches both, and a single change should leave one commit chain.

### Backend: FastAPI + SQLAlchemy 2 (async) + Alembic + psycopg 3

SQLAlchemy 2 typed models with Alembic migrations are the mainstream FastAPI choice and keep the schema versioned for later slices. Alternative: SQLModel - thinner, but less control over migrations and async sessions. Dependencies are managed with `venv` + `pip` and a pinned `requirements.txt` (plus `requirements-dev.txt`).

### Roadmaps stay in YAML and in memory, not in the database

Roadmaps are loaded and validated at startup (Pydantic models) and kept in memory; notes store the full node id as text. Reason: YAML is the single source of truth, edited by hand and reviewed in git; copying it into tables would create a second truth to keep in sync. Cost: no foreign key from notes to nodes, which is why node-linking flags links to missing nodes instead of relying on the database.

Alternative: seed nodes into a `nodes` table. Reconsider when roadmaps become user-editable in the UI.

### Data model

```
notes
  id               uuid pk
  title            text not null
  body_text        text not null          -- extracted readable text
  original_name    text not null
  size_bytes       integer not null
  content_sha256   char(64) unique        -- duplicate detection
  storage_key      text not null          -- key in the file store
  node_id          text null              -- e.g. 'backend/caching'
  created_at, updated_at  timestamptz
```

`body_text` is kept now so Slice 2/3 can chunk and embed it without re-parsing. pgvector is not installed in this slice; the Postgres image is chosen so it can be added later (`pgvector/pgvector:pg17`).

### File storage behind an interface

A small `FileStore` protocol (`put(key, bytes)`, `get(key)`, `delete(key)`) with one `LocalFileStore` that writes content-addressed files to `storage/blobs/<sha[:2]>/<sha>.html`. Content addressing makes duplicate detection and later cloud upload trivial. A Google Drive or S3-style store is a later implementation of the same protocol.

### HTML extraction: BeautifulSoup with lxml

Title from `<title>`, else first `<h1>`, else filename; text with `script`, `style`, `noscript` and `template` removed and whitespace collapsed. Alternative: `selectolax` (faster) - unnecessary at personal scale, and BeautifulSoup tolerates broken markup better. Decoding: UTF-8, falling back to the charset declared in the page; undecodable files are rejected.

### API shape

```
GET    /api/domains
GET    /api/domains/{domain}/roadmap
GET    /api/domains/{domain}/counts
POST   /api/notes/import            multipart, many files -> per-file outcome
GET    /api/notes?node=...&unsorted=true
GET    /api/notes/{id}
PATCH  /api/notes/{id}              { title?, node_id? (null = unlink) }
DELETE /api/notes/{id}
GET    /api/notes/{id}/original     raw HTML, sandboxed (see below)
```

### Showing untrusted HTML

The original is served with `Content-Security-Policy: sandbox allow-scripts` and `X-Content-Type-Options: nosniff`, and shown in `<iframe sandbox="allow-scripts">` without `allow-same-origin`. The page then runs in an opaque origin: its scripts work (Claude pages often need them) but cannot read the app's cookies or storage or call the API with them. Alternative: strip scripts - rejected because many Claude pages render nothing without JavaScript.

### Frontend: Vite + React + TypeScript

- **Map:** React Flow (`@xyflow/react`) with a top-down tree layout computed by `dagre`. Alternative: hand-drawn SVG like roadmap.sh - better looking, but far more work; React Flow gives pan, zoom and selection for free and fits later agent overlays.
- **Server state:** TanStack Query. **Panels:** `react-resizable-panels`. **Styling:** plain CSS modules with design tokens; no component library yet.
- Dev server on port 5173 proxies `/api` to the backend on port 8000.

### Testing and feedback loop

- Backend: pytest against a real Postgres test database from docker-compose (no SQLite stand-in, so migrations are exercised). Roadmap validation and HTML extraction get table-driven unit tests with sample Claude pages under `backend/tests/fixtures/`.
- Frontend: Vitest + Testing Library for list grouping, filtering and selection sync.
- Checks: `ruff` + `mypy` for Python, `eslint` + `tsc --noEmit` for TypeScript. These commands go into CLAUDE.md so agents and the verifier run the same checks.

## Risks / Trade-offs

- [Claude pages load scripts or fonts from CDNs] -> Offline viewing may render without them; acceptable for a local tool, revisit if it hurts.
- [Sandboxed iframe still runs arbitrary scripts] -> They are isolated in an opaque origin and cannot reach the app; only files the user chose are imported.
- [No foreign key between notes and nodes] -> Missing nodes are detected and flagged at read time (node-linking spec).
- [React Flow + dagre layouts look generic compared with roadmap.sh] -> Fine for Slice 1; styling can improve without changing specs.
- [Windows path and line-ending issues] -> Use `pathlib` everywhere, `.gitattributes` with `* text=auto eol=lf`.

## Migration Plan

New project, no existing data. Rollback is dropping the database volume and the `storage/` folder.
