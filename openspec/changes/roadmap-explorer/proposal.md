# Change: roadmap.sh explorer for the assistant

## Why

The owner asked (2026-11-27) to ask the assistant about a role Learning Hub has no roadmap for ("I want to learn about the AI researcher role: tech stack and knowledge") and get an answer built from roadmap.sh. Today the agent only reads roadmap.sh links for nodes that a mapping file in `roadmaps/sources/` ties to a Learning Hub node (`node-resources`), so any other role falls back to general knowledge.

roadmap.sh exposes each official roadmap's graph at `GET https://roadmap.sh/api/v1-official-roadmap/<slug>` (public, no auth, undocumented; checked 2026-11-27: `ai-engineer` answers 200 with 281 nodes, 41 edges, type `role`). The topic texts and links are in `kamranahmedse/developer-roadmap` at `roadmaps/<slug>/content/<topic>@<nodeId>.md` (98 roadmaps). The content is for personal use only (repo `license`), so nothing is stored or committed: the agent reads it at question time and answers in its own words with links back to roadmap.sh.

## What changes

- Three read-only tools for the assistant: `roadmapsh_list` (the roadmap slugs), `roadmapsh_outline` (one roadmap's topics and subtopics in order), `roadmapsh_topic` (one topic's description and links). Results are untrusted content, kept only in a short in-memory cache, never in the database.
- The system prompt tells the assistant to use them when the user asks about a role or skill Learning Hub does not cover, to say plainly when roadmap.sh has no exact roadmap (there is no `ai-researcher`; closest are e.g. `machine-learning`, `ai-engineer`, `ai-data-scientist`), and to link to roadmap.sh instead of copying its text.
- An optional **GitHub** card on Settings -> Agents -> Connections: the user may save a GitHub token (stored encrypted per user, only its last 4 characters shown). Without it the tools still work under GitHub's anonymous limit (60 requests per hour per address); with it, the GitHub listing calls use the token.

## Impact

- New capability spec `roadmap-explorer`.
- Backend: setting `LH_ROADMAPSH_API_BASE`, `LH_ROADMAPSH_REF`; migration `0029_github_tokens` (table + RLS); new `app/roadmapsh/` (client with an injectable HTTP function and a cache); new `routes/github.py`; `agent/tools.py`, `agent/loop.py` (prompt), `routes/agent.py`, `agent/mcp_server.py`, `main.py`.
- Frontend: `ConnectionsSettings.tsx` (GitHub card), `api.ts`, `test/fakeApi.ts`, Vitest.
- E2E: fake roadmap.sh API and fake GitHub `rate_limit` on `frontend/e2e/fake_llm.py`, the tree fake also serves the `LH_ROADMAPSH_REF` listing, `playwright.config.ts` env, new `roadmap-explorer.e2e.ts`.
- The backup archive is an allow-list of tables, so `github_tokens` stays out without a code change (checked by a test).
