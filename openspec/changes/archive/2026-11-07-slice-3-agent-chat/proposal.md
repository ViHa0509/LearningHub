# Proposal

## Why

The right panel has said "The agent is not available yet" since Slice 1, and the owner's review (2026-11-07) flagged it first: the agent is the reason the app exists beyond a file shelf. With lesson pages in place (Slice 2) the agent has something to read and to write: it can answer from the user's own notes and lessons, and draft an empty lesson when asked. This is also the owner's first hands-on agent with tools and several model providers, the core of the Agentic Engineer goal.

## What Changes

- A working chat in the right panel: provider and model picker, message history for the session, Markdown answers, and a visible trace of the tools the agent used.
- Several LLM providers behind one interface: Anthropic (Claude), OpenAI, DeepSeek and a local OpenAI-compatible server (Ollama, for Gemma). A provider is available only when its key or URL is configured on the backend; the panel explains how to configure one when none is.
- Agent tools over the user's data: search notes, read a note, list a roadmap with progress, read a lesson, and write a lesson. Writing never overwrites a lesson the user wrote.
- The chat knows the page the user is on (home, roadmap, lesson or note), so "draft this lesson" or "summarize this note" works without naming it.
- A "Draft with agent" button on an empty lesson page that asks the agent to write it.
- A first eval set (golden questions over seeded notes) that runs against a real provider when a key is present, kept out of the always-on checks.

## Capabilities

### New Capabilities
- `agent-chat`: the chat panel, providers, the tool loop, page context and the lesson-writing rules.
- `agent-evals`: the golden-question eval set and how it is run.

### Modified Capabilities
- `learning-views`: the right panel is the agent chat instead of a placeholder.
- `lesson-pages`: an empty lesson offers to have the agent draft it.

## Impact

- Backend: `app/agent/` (providers, tools, loop), `POST /api/agent/chat`, `GET /api/agent/providers`; new settings `LH_ANTHROPIC_API_KEY`, `LH_OPENAI_API_KEY`, `LH_DEEPSEEK_API_KEY`, `LH_OLLAMA_URL`, `LH_AGENT_MAX_STEPS`; dependencies `anthropic`, `openai`.
- Frontend: `AgentPanel` rewritten, lesson page button, API client additions.
- Tests: backend tests with a scripted fake provider (no network); Vitest for the panel; `backend/evals/` with a `live` marker skipped without a key.
- Security: note text is untrusted (it comes from imported HTML), so tool results are passed to the model as data and the agent's only write is lesson text, which is rendered without HTML.
