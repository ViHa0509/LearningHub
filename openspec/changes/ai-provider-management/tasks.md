# Tasks

## 1. Backend foundation (dev agent: backend)

- [ ] 1.1 Migration 0004: `ai_providers` and `agent_providers`, data moved from `provider_configs`, which is then dropped; SQLAlchemy models. Verify with a migration test for upgrade with an existing `provider_configs` row (moved and assigned) and for downgrade to 0003.
- [ ] 1.2 `app/agent/llm/` errors, params, urls (SSRF) and catalog (`model_catalog.yaml`). Verify with unit tests for each error category, parameter validation per type, and SSRF accept/reject cases with an injected resolver.
- [ ] 1.3 Adapters and `LLMFactory` (parameters sent only when set, timeout, no retries, `list_models`). Verify with unit tests using stubbed SDK clients that check the exact request parameters per type.
- [ ] 1.4 `/api/ai-providers` CRUD, types, test (saved and unsaved), models, header guard, safe delete, stored test result, `.env` import at startup. Verify with API tests for every `ai-providers` scenario using an injected factory.
- [ ] 1.5 Agents registry, `/api/agents` routes, resolution, sticky fallback, and structured logging. The chat route takes `agent_id` and `provider_id`. Verify with tests for every `agent-providers` and modified `agent-chat` scenario, including a caplog test that no key and no message text are logged.

## 2. Frontend (dev agent: frontend)

- [ ] 2.1 API client: the header on every request and the new types and calls. Fake API updated to the new contract.
- [ ] 2.2 Providers list and provider configuration page (sections A-E, show/hide key, slider, advanced section, test with loading state and category messages, info panel, field errors, unsaved-changes warning, delete refusal message). Verify with Vitest tests.
- [ ] 2.3 Agents section and chat panel provider picker (agent default and override, answer caption with fallback), and Draft with agent using `lesson-writer`. Verify with Vitest tests.

## 3. QC end to end (qc-e2e agent)

- [ ] 3.1 Fake OpenAI-compatible LLM server and its Playwright web server entry.
- [ ] 3.2 E2E specs written from this change's scenarios (create, validate, SSRF message, test categories, load models, agents and fallback, chat with override, delete in use, header guard); the full e2e suite passes.

## 4. Verification

- [ ] 4.1 Every CLAUDE.md check passes, the verifier passes, `evidence.md` is written, and the docs (README, CLAUDE.md, `.env.example`) are updated.
