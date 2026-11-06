# Design

## Context

Slice 2 (home, lesson pages, routes, UI checks) is built; this change builds on it and must be archived after it. The backend is sync FastAPI with plain `def` routes (async psycopg does not run on Windows' default loop). No provider key exists on the dev machine yet, so everything must be testable without network, and live behavior is checked by an eval set that runs when a key is added.

## Goals / Non-Goals

**Goals:**
- One agent loop that works the same with every provider, so evals compare models fairly.
- Tools that only read the user's data, plus one narrowly guarded write (lessons).
- Deterministic tests with a scripted fake provider; real-model checks as evals.

**Non-Goals:**
- Streaming tokens (a later change; the answer arrives whole).
- Saving chat history in the database or the journal.
- The Knowledge Hub connector and fetching web pages (later tools).
- Choosing a default provider for the user.

## Decisions

### Server-side tool loop, provider-neutral messages

`app/agent/loop.py` owns the loop. It keeps the conversation as neutral messages (`user` text, `assistant` text plus tool calls, `tool` results with call ids). Each provider adapter translates neutral messages and tool schemas to its API and back:

```
ChatProvider.complete(system, messages, tools, model) -> Turn(text, tool_calls[])
  AnthropicProvider        anthropic SDK, messages.create, tool_use / tool_result blocks
  OpenAICompatibleProvider openai SDK, chat.completions.create, function tools
      - openai   (api.openai.com)
      - deepseek (https://api.deepseek.com)
      - ollama   (<LH_OLLAMA_URL>/v1, no key, for Gemma)
  FakeProvider (tests)     scripted turns, records what it received
```

The loop runs at most `LH_AGENT_MAX_STEPS` model calls (default 6). Alternative: let the browser run the loop and call tools through the API - rejected, keys would have to reach the browser and every tool would need its own route.

The Anthropic tool runner in the SDK was considered; a hand-written loop keeps one code path for all providers and makes the trace explicit, which the evals and the UI need.

### Models offered

Anthropic: `claude-sonnet-5-5` (default), `claude-haiku-5-5`, `claude-opus-5-5`. OpenAI: `gpt-5.5` (default), `gpt-5.5-mini`. DeepSeek: `deepseek-chat`. Ollama: `gemma3` (default; the user can type another local model id). Model lists live in one table in `app/agent/providers.py` and can be changed without touching the loop. Model names for non-Anthropic providers are a best guess and are not verified on this machine (no keys); a wrong id surfaces as a provider error in the panel.

### Tools

| Tool | Input | Returns |
|---|---|---|
| `search_notes` | `query` | up to 8 notes: id, title, node, snippet around the match (title and text, case-insensitive) |
| `read_note` | `note_id` | title, node, text (first 6000 characters) wrapped as untrusted |
| `list_roadmap` | `domain` | nodes with title, parent, note count, and whether a lesson exists |
| `read_lesson` | `node_id` | body, source |
| `write_lesson` | `node_id`, `markdown` | saved, or an error when the lesson is user-written |

Tool errors (unknown id, protected lesson, bad input) come back to the model as `{"error": ...}` results, never as HTTP errors. Note text is wrapped as `<untrusted_note_content>...</untrusted_note_content>`, and the system prompt states that such content is data and never instructions. The agent has no delete tool and cannot touch notes, so a prompt injection in a note can at most produce a bad agent-written lesson, which the user can edit or clear.

### API

```
GET  /api/agent/providers -> [{id, label, available, setting, models, default_model}]
POST /api/agent/chat {provider, model, messages:[{role:'user'|'assistant', content}], page}
  200 {reply, steps:[{tool, input, summary}], changed_lessons:[node_id], stopped:bool}
  409 provider not available (names the setting)   400 unknown provider or empty conversation
  502 provider error (names the provider, passes its message)
```

The client sends the visible conversation (text only) each time; the server does not keep chat state. `page` is `{kind:'home'|'roadmap'|'lesson'|'note', domain?, node?, note_id?}`.

### Settings

`LH_ANTHROPIC_API_KEY`, `LH_OPENAI_API_KEY`, `LH_DEEPSEEK_API_KEY` (secrets, `SecretStr`, never logged or returned), `LH_OLLAMA_URL` (e.g. `http://localhost:11434`), `LH_AGENT_MAX_STEPS`. `backend/.env.example` documents them. `app.state.providers` is built at startup from settings; tests replace it with fakes.

### Frontend

`AgentPanel` holds the session conversation in state (lost on reload; persistence is out of scope). It calls `/api/agent/providers` once, shows a picker of available providers and their models (remembered in localStorage), renders answers with `react-markdown`, and lists tool steps in a collapsible "Used n tools" block. After an answer with `changed_lessons`, it invalidates those lesson queries so an open lesson page refreshes. The lesson page's "Draft with agent" button calls a callback that AppShell routes to the panel as a prefilled request that is sent at once.

### Evals

`backend/evals/test_golden.py` with a `live` pytest marker, excluded from the default `pytest` run (`addopts = -m "not live"`) and run with `pytest -m live`. It seeds the test database, runs the same `run_agent` with the configured provider, and checks tool names, required facts in the answer (case-insensitive substrings) and lesson state. Skipped with a reason when no key is set. Not a CLAUDE.md check, because it needs a key and costs money; it is listed as a command with `Check? = no`.

## Risks / Trade-offs

- [Prompt injection from imported pages] -> Untrusted wrapping, no destructive tools, the single write is guarded and visible in the trace.
- [Unverified model ids for OpenAI, DeepSeek, Ollama] -> Errors are shown clearly; ids are in one table.
- [No streaming: long answers feel slow] -> A working indicator; streaming is a later change.
- [Cost] -> Step limit, short tool results (snippets, 6000-character note cap).

## Migration Plan

No schema change. New settings are optional; without them the panel explains how to configure a provider.
