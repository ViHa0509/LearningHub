# Vision

The scope the owner confirmed. The brainstormer stays inside it; changing it is the owner's decision.

## Goals

1. Never lose past learning: research done with Claude (standalone HTML pages) is kept, placed on a roadmap and found again by where it sits in a domain.
2. See progress per role (Frontend, Backend, DevOps, QA, Data Engineer, ...) on roadmap.sh-style maps, and know what to learn next.
3. A learning journal that shows what was learned and when.
4. An agent in the right panel that answers questions from the user's own notes and lessons, can draft lessons, and suggests next topics.
5. Serve as the owner's real-world showcase of an AI-native SDLC (spec -> plan -> code -> review -> verify, agent team, evals) for an Agentic Engineer career.

## In scope

- Import of Claude-generated HTML pages (only those), shown safely in a sandbox.
- Hand-written roadmap YAML per domain; lesson text per node (user- or agent-written).
- Home page with role cards, roadmap maps, lesson pages, note pages, light/dark theme.
- Agent chat with several LLM providers (Anthropic, OpenAI, DeepSeek, Gemma/local), tools over notes, lessons and roadmaps.
- Optional connector to the owner's Knowledge Hub (KH) as an agent tool.
- Learning journal and visualizations of progress.
- Evals and UI checks that keep the agent and the app honest.

## Out of scope

- Multiple users, accounts, sharing or public hosting.
- Copying roadmap.sh content into the repo (links are fine).
- Importing arbitrary web pages or non-HTML documents.
- Editing roadmaps from the UI (YAML in git stays the source of truth).
- Mobile apps.

## Confirmed decisions

- Own Postgres database is the store; KH is only an optional agent tool.
- Stack: React (Vite, TypeScript), FastAPI, Postgres; files stored locally behind an interface, cloud later.
- Two repos: LearningHub and the reusable `ai-sdlc-kit` plugin.
- Defaults to English for code, UI and docs.

## Open questions

- Which cloud store for files later (Google Drive or object storage)?
- Fetching lesson content from roadmap.sh: allowed only for personal use; how to map nodes?
- Which local model runtime for Gemma (Ollama or other)?
