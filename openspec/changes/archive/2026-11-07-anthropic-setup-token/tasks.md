# Tasks

## 1. Backend (spec: ai-providers)

- [x] 1.1 Remove whitespace from keys before validation and storage (create, update, test before save), and verify a pytest case for a key wrapped over lines
- [x] 1.2 Send `sk-ant-oat` keys as `auth_token` with the OAuth beta header and other keys as `api_key`, and verify factory tests for both kinds (no key sent both ways)
- [x] 1.3 Return `key_kind` (`api_key` or `setup_token`, null without a key) in provider answers, and verify the API test that it shows the kind and never the key

## 2. Frontend (spec: ai-providers)

- [x] 2.1 Label the Anthropic key field "API key or setup token" with a hint, show "Setup token …abcd" when that kind is saved, and verify Vitest tests

## 3. Verification

- [x] 3.1 Run every CLAUDE.md check including e2e, and record the results in `evidence.md`
