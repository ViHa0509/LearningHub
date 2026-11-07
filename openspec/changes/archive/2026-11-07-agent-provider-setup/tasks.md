# Tasks

## 1. Backend (spec: provider-settings, agent-chat)

- [x] 1.1 Add migration 0003 `provider_configs`, the `cryptography` dependency and `app/agent/secrets.py` (Fernet from `LH_SECRET_KEY` or a key file created in the storage folder), and verify tests for encrypt/decrypt round trip, key file reuse and an unreadable key
- [x] 1.2 Add `ProviderRegistry` (merge app rows and env, enabled switch, chosen model, injectable client factory, reload) and use it in the chat route and `GET /api/agent/providers` (source, hint, enabled, model, overrides_env), and verify tests for precedence, switch off, removal fallback and that no key is returned
- [x] 1.3 Add `PUT`/`DELETE /api/agent/providers/{id}` and `POST /api/agent/providers/{id}/test` with validation, and verify API tests for every provider-settings scenario using a fake client factory
- [x] 1.4 Add the per-minute chat rate limit with 429 and `Retry-After`, and verify a test with a limit of 2

## 2. Frontend (spec: provider-settings)

- [x] 2.1 Add the Settings page (`#/settings`), the top-bar link and the agent panel's "Open settings" link, and verify Vitest tests for save, custom model, Ollama URL validation message, test result, switch off and remove
- [x] 2.2 Make the chat use the chosen model per provider (custom model listed), and verify a Vitest test

## 3. Verification

- [x] 3.1 Extend e2e: save a dummy Anthropic key in Settings and see the chat appear without a restart, then remove it; run every check, the UI QC agent and the verifier, record `evidence.md`
