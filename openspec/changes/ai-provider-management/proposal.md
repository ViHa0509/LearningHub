# Proposal

## Why

The provider setup built earlier on 2026-11-07 allows one fixed slot per vendor with only a key and a model. The owner's feature brief "AI Provider Management for Multi-Agent System" asks for more:
- named provider configurations (several per vendor, including Gemini, local and custom OpenAI-compatible servers);
- model parameters (temperature, max tokens, top p, timeout, advanced settings);
- a categorized connection test;
- a provider assigned to each agent, with an optional fallback;
- one central LLM factory.

Learning Hub already has two agent jobs: the chat assistant and the lesson drafter. Both should run on configurations the owner manages, not on hardcoded vendor slots.

The owner also asked for a QC agent that tests features end to end. This change is the first one where that agent writes the e2e tests from the specs, independently of the developers.

## What Changes

- **BREAKING** (API): the one-slot-per-vendor `provider_configs` API (`/api/agent/providers...`) is replaced by `/api/ai-providers` (CRUD, test, models) and `/api/agents/{id}/provider`. A migration moves existing saved keys into the new table, and `LH_*_API_KEY` values from `backend/.env` are imported once as providers.
- Provider configurations: name, type (OpenAI, Anthropic, Google Gemini, Local, Custom), model, encrypted key, base URL, temperature, max tokens, top p, timeout, advanced parameters (only those the type supports, plus provider-specific JSON), an active switch, and a stored last test result.
- Connection test, for both saved and unsaved settings. It reports one of: success, authentication failed, invalid model, provider unavailable, timeout, rate limited, or invalid configuration, together with the response time.
- "Load models" lists the models the provider actually offers. Model presets come from a configuration file, and any model id can be typed in.
- Agents: `assistant` (the chat) and `lesson-writer` (Draft with agent). Each has a primary provider and an optional fallback. Several agents can share one provider. An agent without an assignment uses the first active provider.
- Fallback goes to the fallback provider only on recoverable errors (timeout, rate limit, provider unavailable). It never happens on authentication, invalid model or configuration errors. Every fallback is logged.
- One LLM factory builds a chat model from a provider configuration. Adapters: Anthropic SDK, and an OpenAI-compatible adapter for OpenAI, Gemini (its OpenAI endpoint), Local and Custom.
- Security:
  - keys encrypted and never returned;
  - base URLs checked against SSRF (only Local may point at private or loopback addresses);
  - mutating endpoints require the `X-LearningHub` header, so other origins, including imported note pages, cannot change settings;
  - structured logs never contain keys or prompt text.
- UI:
  - a providers list;
  - a provider configuration page with the brief's sections A to E: show/hide key, temperature slider, a loading state while testing, an unsaved-changes warning;
  - an Agents section;
  - a chat panel that shows the agent's provider and allows a per-conversation override.
- QA: a fake OpenAI-compatible LLM server for e2e runs, and a new kit agent `qc-e2e` that writes Playwright tests from spec scenarios and runs them.

## Capabilities

### New Capabilities
- `ai-providers`: provider configurations, encryption, validation, connection test, model listing, the LLM factory.
- `agent-providers`: agents, their primary and fallback providers, resolution and fallback behavior.

### Modified Capabilities
- `provider-settings`: replaced by `ai-providers`; all of its requirements are removed.
- `agent-chat`: providers come from provider configurations through the agent's assignment; the chat request names an agent and an optional provider override instead of a vendor and a model.

## Impact

- Backend:
  - `app/agent/llm/` (errors, adapters, factory, url checks, catalog);
  - `app/agent/agents.py`;
  - routes `app/routes/ai_providers.py` and `app/routes/agents.py`;
  - migration 0004 (`ai_providers`, `agent_providers`, data moved from `provider_configs`, which is dropped);
  - `backend/app/agent/model_catalog.yaml`.
- Frontend: Settings pages rewritten (providers list, provider page, agents), the chat panel's provider picker, and the lesson draft calling the `lesson-writer` agent.
- E2E: a fake LLM server (`frontend/e2e/fake_llm.py`) as a third web server, and new specs written by `qc-e2e`.
- Kit: a new agent `agents/qc-e2e.md` (ai-sdlc-kit 0.3.0).
