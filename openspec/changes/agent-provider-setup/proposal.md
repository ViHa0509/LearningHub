# Proposal

## Why

The agent only works after the owner edits `backend/.env` and restarts the backend, and the owner asked (2026-11-07) that a user only has to paste a key to use the agent. A settings page is also where the cost risks of metered keys belong: proving the key and model with a real call, switching a provider off, and limiting how often the agent can be called (KH lesson "Metered AI API keys need spend limits and per-feature switches").

## What Changes

- A Settings page (`#/settings`, linked from the top bar and from the agent panel when nothing is configured) with one card per provider: status, a key field (a URL field for Ollama), the model to use (from the list or a custom id), an on/off switch, and Save, Test and Remove buttons.
- Keys entered in the app are stored encrypted in the database with a key file kept on this computer, never returned to the browser (only the last four characters), and take effect at once without a restart.
- "Test" makes one small real call with the saved settings and reports success or the provider's error, with the time it took.
- Keys in `backend/.env` keep working; a key saved in the app wins over the `.env` one, and the page shows which source is used.
- A provider can be switched off without deleting its key; a switched-off provider is not offered in the chat.
- A per-minute limit on chat requests (default 20) so a loop or a stuck page cannot run up a bill.

## Capabilities

### New Capabilities
- `provider-settings`: entering, storing, testing, switching and removing provider keys and models from the app.

### Modified Capabilities
- `agent-chat`: providers come from the app settings or `backend/.env`, the chosen model per provider is the chat default, switched-off providers are not available, and chat requests are rate-limited.

## Impact

- Backend: migration 0003 `provider_configs`; `app/agent/secrets.py` (Fernet, key file `storage/secret.key` or `LH_SECRET_KEY`); a provider registry rebuilt on every settings change; routes `PUT/DELETE /api/agent/providers/{id}`, `POST /api/agent/providers/{id}/test`; `GET /api/agent/providers` gains `source`, `key_hint`, `enabled`, `base_url`; new dependency `cryptography`; setting `LH_AGENT_RATE_PER_MINUTE`.
- Frontend: `SettingsPage`, top-bar link, agent panel link, route `#/settings`.
- Tests: pytest for storage, encryption, masking, precedence, test call (fake client factory), rate limit; Vitest for the page; e2e saves a dummy key and sees the chat appear (no real call).
