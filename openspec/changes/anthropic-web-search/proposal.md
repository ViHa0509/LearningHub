# Proposal

## Why

An agent can search the web only when it runs on a Claude Code provider, which works on the owner's PC but not on the hosted app. The owner asked for web search on the hosted app too and chose Anthropic's own web search tool (2026-11-13): no extra account or key, billed per search on the Anthropic API key.

## What Changes

- With the agent's Internet search switch on and an **Anthropic** provider, each model call offers Anthropic's web search tool (a server tool, at most 5 searches per call; the dynamic-filtering version on recent models, the basic one on older ones).
- Each search shows in the trace as "Searched the web for '<query>'". Pages the searches found and the answer does not link yet are listed under "Sources:" at the end of the answer (at most 8), as data.
- The search blocks of an answer are sent back unchanged on the next model call of the same request; a paused search turn is continued a few times at most.
- Settings → Agents says Internet search needs a Claude Code or Anthropic provider (instead of Claude Code only).
- OpenAI, DeepSeek, Ollama and custom providers: unchanged, no web search.

## Capabilities

### New Capabilities

### Modified Capabilities
- `agent-providers`: "Internet search per agent" covers Anthropic providers.

## Impact

- Backend: `app/agent/messages.py` (searches, sources and raw blocks on a turn), `app/agent/llm/adapters.py` (tool, parsing, pause_turn), `app/agent/resolve.py`, `app/agent/loop.py`.
- Frontend: `components/SettingsPage.tsx` (the note under the switch).
- Tests: new `backend/tests/test_anthropic_web_search.py`; `SettingsPage.test.tsx`, `e2e/agent-web-search.e2e.ts` for the new note. A real search is not run in CI (no Anthropic key there).
- Cost: Anthropic bills each web search on the user's key, on top of tokens.
