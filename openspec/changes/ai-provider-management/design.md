# Design

## Context

Today's code (2026-11-07):
- `app/agent/providers.py` has the neutral types' adapters (`AnthropicProvider`, `OpenAICompatibleProvider`, translation functions) and the `CATALOG` of four vendor slots.
- `app/agent/registry.py` merges `provider_configs` rows with `LH_*` env values; `app/agent/secrets.py` has `SecretBox`, `key_hint` and the key file.
- `app/routes/agent.py` has `/api/agent/providers` CRUD/test and `/api/agent/chat`; `app/agent/loop.py` has `run_agent(provider, model, ...)`; `app/agent/ratelimit.py` has the limiter.
- The frontend has `SettingsPage.tsx` (one card per vendor) and `AgentPanel.tsx` (provider + model selects).

The app is single-user and local with no login. The feature brief comes from another product (SimpleMDG, SAP HANA). Its structure is adapted here to this codebase: Postgres, sync SQLAlchemy, `app/agent/` package, routes in `app/routes/`, no LangChain.

## Goals / Non-Goals

**Goals:** named configurations; per-agent primary and fallback; one factory; categorized tests; SSRF and secret safety; a config page with sections A-E; e2e coverage written by a QC agent against a fake LLM server.

**Non-Goals:**
- User accounts or roles. The "permission check" is the same-origin header guard; real authentication is out of scope per VISION.
- LangChain. The project has its own neutral message types and adapters, and adding LangChain would duplicate them (brief rule 2).
- Streaming.
- Agents defined in the database.

## Decisions

### Data model (migration 0004)

```
ai_providers
  id                uuid pk
  name              text not null unique
  provider_type     text not null        -- openai | anthropic | gemini | local | custom
  model_name        text not null
  api_key_enc       text null            -- Fernet token (SecretBox), same secret as before
  key_hint          text null            -- '…1234'
  base_url          text null
  config            jsonb not null default '{}'
                    -- {temperature, max_tokens, top_p, top_k, timeout, frequency_penalty,
                    --  presence_penalty, stop: [str], seed, response_format: 'text'|'json',
                    --  context_window, extra: {..}}  (absent key = not set)
  is_active         boolean not null default true
  last_test_at      timestamptz null
  last_test_status  text null            -- ok | auth_failed | invalid_model | unavailable | timeout | rate_limited | invalid_config
  last_test_message text null
  last_test_latency_ms integer null
  last_success_at   timestamptz null
  created_at, updated_at timestamptz

agent_providers
  agent_id     text not null             -- 'assistant' | 'lesson-writer' (code registry)
  role         text not null             -- 'primary' | 'fallback'
  provider_id  uuid not null references ai_providers(id) on delete restrict
  created_at, updated_at
  primary key (agent_id, role)
```

The brief's `is_primary` and `is_fallback` flags become one `role` column with the pair as primary key, which makes "at most one primary and one fallback per agent" structural.

Data migration: for every `provider_configs` row with a key or a URL, insert an `ai_providers` row:
- name = vendor label (Anthropic, OpenAI, DeepSeek, Ollama);
- type = `anthropic` / `openai` / `custom` (DeepSeek, base URL `https://api.deepseek.com`) / `local` (Ollama, base URL + `/v1`);
- model = row model or the old default;
- `api_key_enc` and `key_hint` copied unchanged;
- `is_active` from `enabled`.

The first inserted row becomes the primary of both agents. Then `provider_configs` is dropped. Downgrade recreates `provider_configs` empty and drops the new tables, so saved provider settings are lost on downgrade; that is stated in the migration docstring.

### Module layout (`backend/app/agent/`)

```
llm/__init__.py
llm/errors.py        ErrorCategory (Literal), ProviderError(message, category), RECOVERABLE = {timeout, rate_limited, unavailable}
                     classify_anthropic(exc), classify_openai(exc) -> ProviderError
llm/params.py        PROVIDER_TYPES table: label, needs_key, needs_base_url, default_base_url,
                     supported params, capabilities; validate_config(type, config) -> list of field errors
llm/urls.py          validate_base_url(type, url, resolve=socket.getaddrinfo) -> normalized url or raises ValueError
llm/catalog.py       loads model_catalog.yaml: presets per type [{id, context_window?, max_output?}]
llm/adapters.py      AnthropicChat, OpenAICompatibleChat: complete(system, messages, tools) -> Turn,
                     list_models() -> list[str]; bound to model, params, timeout. Translation
                     functions move here from providers.py (unchanged behavior).
llm/factory.py       ProviderSettings (dataclass: id, name, type, model, key, base_url, config)
                     LLMFactory.create(settings) -> ChatModel ; injectable in app.state.llm_factory
agents.py            AGENTS: {id: AgentDef(id, name, description, instructions)}
resolve.py           resolve_chain(session, box, factory, agent_id, override_id) -> list[(ProviderRow, ChatModel)]
                     FallbackModel(primary, fallback, agent_id, log): complete(...) sticky fallback
providers.py         kept only as a thin re-export for old imports, or removed (tests updated)
registry.py          removed (replaced by repository + resolve)
```

`ChatModel` protocol: `complete(system, messages, tools) -> Turn`, `list_models() -> list[str]`, `model: str`. `run_agent` changes from `(provider, model, ...)` to `(chat_model, ...)`. The loop logic stays the same.

Gemini goes through its OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai/`) with the `openai` SDK, so no new SDK is needed. Local and Custom use the `openai` SDK with the given base URL; Local uses the key `"local"` when none is given.

Timeouts: the SDK client takes `timeout=config.timeout or 60` and `max_retries=0`, so the test and the fallback measure real failures instead of SDK retries.

Error classification:

| Error | Category |
|---|---|
| `AuthenticationError`, `PermissionDeniedError` (401, 403) | `auth_failed` |
| `NotFoundError` (404), or `BadRequestError` mentioning "model" | `invalid_model` |
| `RateLimitError` (429) | `rate_limited` |
| `APITimeoutError` | `timeout` |
| `APIConnectionError`, `InternalServerError` (5xx) | `unavailable` |
| other `BadRequestError` | `invalid_config` |

Both SDKs use the same class names.

### Parameters sent

Only keys present in `config` and supported by the type are sent.
- Anthropic: `temperature`, `top_p`, `top_k`, `max_tokens` (default 2048 when unset, because Anthropic requires it), `stop_sequences` (from `stop`).
- OpenAI-compatible: `temperature`, `top_p`, `max_tokens`, `frequency_penalty`, `presence_penalty`, `stop`, `seed`, `response_format={"type":"json_object"}` when it is `json`.
- `extra` is merged last: Anthropic via `extra_body`, OpenAI via `extra_body`.

Validation runs on create, update and test-config. It returns HTTP 422 with `detail: [{"field": "temperature", "msg": "..."}]`.

### SSRF check

- Parse with `urllib.parse`. The scheme must be `http` or `https`, the URL must have no userinfo, and the host must not be empty.
- For types other than `local`: the scheme must be https, and every address `getaddrinfo` returns for the host must be global. The check uses `ipaddress.ip_address(a).is_global` and rejects loopback, private, link-local (169.254.x.x, fe80::), reserved, multicast and unspecified addresses.
- `local` skips the address check.
- The resolver is injectable for tests.
- The check runs on save, on test, and again in the factory just before the client is built. DNS rebinding between check and connect is a known gap, accepted for a single-user local app.

### API (all JSON; mutating calls need header `X-LearningHub: 1`, else 403)

```
GET    /api/ai-providers/types      -> [{type, label, needs_key, needs_base_url, default_base_url,
                                          params: [names], capabilities: [str], models: [{id, context_window, max_output}]}]
GET    /api/ai-providers            -> [ProviderOut]
GET    /api/ai-providers/{id}       -> ProviderOut               (404)
POST   /api/ai-providers            ProviderIn -> 201 ProviderOut (409 name taken, 422 validation)
PUT    /api/ai-providers/{id}       ProviderIn (api_key empty/absent = keep) -> ProviderOut
DELETE /api/ai-providers/{id}       -> 204 | 409 {detail, agents:[{id,name,role}]}
POST   /api/ai-providers/{id}/test  -> TestResult (stored on the row)
POST   /api/ai-providers/test       ProviderIn + optional provider_id (reuse stored key) -> TestResult (not stored)
GET    /api/ai-providers/{id}/models -> {models: [str]}  (502 {detail} on provider error)
GET    /api/agents                  -> [AgentOut]
GET    /api/agents/{id}/provider    -> AgentOut                  (404 unknown agent)
PUT    /api/agents/{id}/provider    {primary_provider_id: uuid|null, fallback_provider_id: uuid|null} -> AgentOut
POST   /api/agent/chat              {agent_id='assistant', provider_id?: uuid, messages, page}
                                     -> {reply, steps, changed_lessons, stopped,
                                         provider: {id, name, model}, fallback_used: bool}
                                     409 no active provider / override inactive; 404 override unknown;
                                     502 provider error (detail names provider(s) and category); 429 rate limit
```

```
ProviderIn  {name, provider_type, model_name, api_key?, base_url?, is_active=true,
             config: {temperature?, max_tokens?, top_p?, top_k?, timeout?, frequency_penalty?,
                      presence_penalty?, stop?: [str], seed?, response_format?, context_window?, extra?: {}}}
ProviderOut {id, name, provider_type, model_name, key_hint, has_key, base_url, config, is_active,
             last_test: {status, message, latency_ms, at} | null, last_success_at,
             used_by: [{agent_id, agent_name, role}], created_at, updated_at}
TestResult  {status, ok, message, latency_ms, model, tested_at}
AgentOut    {id, name, description, primary: ProviderRef|null, fallback: ProviderRef|null,
             effective: ProviderRef|null, effective_reason: 'override'|'primary'|'default'|'none'}
ProviderRef {id, name, provider_type, model_name, is_active, last_test_status}
```

The old `/api/agent/providers*` routes are removed.

### Startup import of `.env`

After migrations, `create_app` imports env keys in a `try` block, tolerating a missing table as before:
- for each of `LH_ANTHROPIC_API_KEY`, `LH_OPENAI_API_KEY`, `LH_DEEPSEEK_API_KEY` and `LH_OLLAMA_URL` that is set and non-blank, it creates "<Label> (from .env)" if no configuration has that name;
- the key is encrypted, and the model is the catalog default.

The import happens once; editing `.env` later does not change the configuration. The README says so.

### Logging

Logger `learninghub.llm`. Each record is a message name plus a fixed set of fields in `extra`:
- names: `llm.call`, `llm.call_failed`, `llm.test`, `llm.fallback`, `llm.provider_init`;
- fields: `agent_id`, `provider_id`, `provider_type`, `model`, `duration_ms`, `category`.

A test with `caplog` asserts that no record contains the key or the user's message.

### Frontend

- Routes:
  - `#/settings` shows the providers list (cards: name, type, model, active, last test badge, used by) with an "Add provider" button, and an "Agents" section;
  - `#/settings/providers/new` and `#/settings/providers/<id>` open the provider page.
- The provider page has five sections:
  - A: type cards, as a radio group;
  - B: name, model (input with a datalist of catalog presets, plus "Load models" when saved), API key (password field with a Show/Hide button; placeholder "Saved (…1234), type to replace"), base URL (prefilled with the type's default), temperature (number + range 0-2, step 0.1), max tokens, top p, timeout;
  - C: `<details>` "Advanced parameters" with only the type's params, plus a "Provider-specific parameters (JSON)" textarea;
  - D: a "Test Connection" button with a loading state; the result names the category in plain words;
  - E: the info panel.
- Buttons: Save Changes, Delete (existing only), Active switch.
- Field errors come from the 422 `detail[].field` and are shown under each field.
- Unsaved changes: a `beforeunload` handler while dirty, and a `confirm()` on in-app navigation (the hashchange is intercepted and reverted when the user cancels).
- Agents section: per agent, a primary select ("Default: first active provider" plus active configurations), a fallback select ("None" plus configurations), the model, the status badge and Save.
- Chat panel: the provider select offers "Agent default (Name · model)" plus the active configurations; there is no separate model select. Each answer is captioned with "Name · model" and "(fallback)" when used. With nothing configured, the panel shows "Open settings".
- API client: `request()` adds `X-LearningHub: 1` to every request.

### E2E and QC

- `frontend/e2e/fake_llm.py` is a FastAPI app run with the backend venv on port 8002, as a third Playwright web server. It is OpenAI-compatible: `GET /v1/models` and `POST /v1/chat/completions`. The model name selects the behavior:
  - `fake-ok` replies "OK from fake";
  - `fake-401` returns 401;
  - `fake-404` returns 404 "model not found";
  - `fake-429` returns 429;
  - `fake-500` returns 500;
  - `fake-slow` sleeps 5 s, so a timeout of 1 s makes it time out.
- The e2e tests configure `local` providers pointing at `http://127.0.0.1:8002/v1`, so no real provider is ever called.
- The tests are written by the `qc-e2e` agent from this change's scenarios. The developers do not write the e2e specs for this change; they keep unit and API tests.

## Risks / Trade-offs

- [BREAKING API for the chat panel] -> Frontend and backend change together in this change; no external clients exist.
- [Downgrade loses provider settings] -> Documented; the keys can be pasted again.
- [Header guard is not authentication] -> Stops cross-origin and sandboxed-page requests, which is the realistic threat for a local single-user app.
- [Unverified model ids in the catalog] -> "Load models" and Test Connection show the real ids and errors.

## Migration Plan

Run `alembic upgrade head` (0004). Existing saved providers become configurations assigned to both agents. `.env` keys are imported at the next start. Rollback: `alembic downgrade 0003`; saved providers must then be entered again.
