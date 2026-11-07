# Design

## Context

Providers are built once at startup from `LH_*` settings (`app.state.providers`), so a new key needs a `.env` edit and a restart. The app is single-user and local: the API listens on 127.0.0.1 and has no login. Imported pages run in an opaque-origin sandbox; they cannot read API answers, and their cross-origin JSON `PUT`/`POST` requests fail the CORS preflight because the API sends no CORS headers.

## Goals / Non-Goals

**Goals:**
- Paste a key, save, chat: no restart, no file editing.
- Keys never leave the backend in clear text, and are not readable from the database alone.
- Make cost visible and bounded: real test call, on/off switch, rate limit.

**Non-Goals:**
- Login or multi-user protection of the settings (the app is local and single-user; see VISION).
- Token or money accounting per request (a later idea).
- Per-feature switches beyond the agent chat (the agent is the only paid feature).

## Decisions

### Storage: one row per provider, key encrypted with Fernet

```
provider_configs
  provider_id   text primary key      -- 'anthropic' | 'openai' | 'deepseek' | 'ollama'
  api_key_enc   text null             -- Fernet token
  key_hint      text null             -- '…1234'
  base_url      text null             -- Ollama only
  model         text null             -- chosen model, may be custom
  enabled       boolean not null default true
  updated_at    timestamptz not null
```

The Fernet key comes from `LH_SECRET_KEY` when set, else from `<storage_dir>/secret.key`, created on first use (the storage folder is git-ignored and already holds the user's files). Losing the key file makes saved keys undecryptable: they are then reported as "saved key cannot be read, enter it again" rather than crashing. Alternative: write keys into `backend/.env` from the API - rejected, it rewrites a hand-edited file and still needs a reload; a plain-text column - rejected, a database dump would leak keys.

### A registry rebuilt on every change

`ProviderRegistry` (in `app.state.registry`) holds the effective config per provider, merged from settings and the table, and a provider instance per available id. `reload(session)` runs at startup and after every PUT/DELETE. Effective config per provider: app row (if it has a key or URL) else env; `enabled` from the row (default on); model = row model or catalog default. Client construction goes through `app.state.provider_factory(provider_id, key, base_url)`, which tests replace with fakes - no network in tests.

`GET /api/agent/providers` adds `source` (`app`, `env` or null), `overrides_env`, `key_hint` (for env keys too, computed from the setting), `enabled`, `model`, `base_url` (Ollama only) and `key_error` (saved key unreadable). The chat route takes providers from the registry.

### API

```
PUT    /api/agent/providers/{id}       {api_key?, base_url?, model?, enabled?}  -> provider row as in GET
DELETE /api/agent/providers/{id}       remove the app row (falls back to env)  -> provider row
POST   /api/agent/providers/{id}/test  -> {ok, model, latency_ms, message}
```

`api_key` omitted or empty keeps the stored key. Keys are trimmed and limited to 300 characters; `base_url` must be `http(s)://...`; `model` matches the existing model-id pattern. Unknown provider is 404. The test sends one user message "Reply with the word OK." without tools through the same adapter and `max_tokens` 16; an unconfigured provider is 409; a provider error is a 200 with `ok: false` and the provider's message (the test itself worked; the provider said no).

### Rate limit

A process-local sliding window (deque of timestamps) in the chat route, `LH_AGENT_RATE_PER_MINUTE` (default 20); over the limit is 429 with `Retry-After`. One process, one user: no shared store needed. Test calls are not limited (one click, one call).

### Frontend

`#/settings` route, a "Settings" link in the top bar, and an "Open settings" link in the agent panel's not-configured message. One card per provider: status line, key input (`type=password`, `autocomplete=off`), Ollama URL input, model select with an "Other..." option that reveals a text field, enabled switch, Save, Test, Remove (only for app-saved). After save or remove the providers query is invalidated, so the panel switches from help text to chat at once. The panel uses the provider's chosen model as its default, and a saved custom model is added to the model list. A short note on the page says usage is billed by the provider and suggests a spend limit in the provider's console.

## Risks / Trade-offs

- [Any local process can call the settings API] -> Accepted for a single-user local app; the API binds to 127.0.0.1; noted in VISION as out of scope (multi-user).
- [Key file next to user data] -> Same trust level as the database on this machine; `LH_SECRET_KEY` lets the owner keep it elsewhere.
- [Process-local rate limit resets on restart] -> Fine for one user; the goal is to stop runaway loops, not abuse.

## Migration Plan

Migration 0003 adds `provider_configs`; downgrade drops it. Existing `.env` keys keep working unchanged.
