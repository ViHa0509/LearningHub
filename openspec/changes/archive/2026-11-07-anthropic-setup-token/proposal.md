## Why

Saving an Anthropic provider with a token from `claude setup-token` fails with "the key must be one word of at most 500 characters". The terminal wraps the long token over several lines, so the pasted value contains line breaks, and the check rejects any whitespace. Even with clean text, the token would fail: a setup token is an OAuth access token (`sk-ant-oat…`), which the Anthropic API accepts only as an OAuth bearer token with the OAuth beta header, not as an API key.

## What Changes

- Whitespace inside a pasted key (spaces, tabs, line breaks from terminal wrapping) is removed before the key is checked and saved, for every provider type. Keys never contain whitespace, so this loses nothing.
- An Anthropic key that starts with `sk-ant-oat` is treated as a Claude setup token: the client sends it as an OAuth bearer token (`auth_token`) with the `anthropic-beta: oauth-2025-04-20` header. Any other key is still sent as an API key, without that header.
- The Anthropic key field is labelled "API key or setup token", with a one-line hint on both kinds; provider information says which kind is saved.
- Test Connection is unchanged and reports what the API answers (for example `auth_failed` or `rate_limited`).
- Not included: imitating Claude Code (for example a system prompt that claims to be Claude Code) to get past limits Anthropic puts on setup tokens. A setup token belongs to the user's Claude subscription, which Anthropic meant for its own apps; the app sends it as-is and shows the API's answer.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `ai-providers`: keys are normalized; Anthropic accepts an API key or a Claude setup token.

## Impact

- Database: Alembic migration 0006 adds a nullable `key_kind` column to `ai_providers` (null on old rows is read as `api_key`).
- Backend: key check in `routes/ai_providers.py`, Anthropic client creation in `agent/llm/factory.py`, provider info output.
- Frontend: label and hint on the key field for Anthropic in `ProviderPage`.
- The key is stored encrypted as before; its kind is derived from its prefix when it is saved.
