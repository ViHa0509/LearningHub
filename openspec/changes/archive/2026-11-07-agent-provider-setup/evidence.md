# Evidence log: agent-provider-setup

Built on 2026-11-07 after the owner asked for the agent to work as soon as a user pastes a key. The design also applies the KH lesson "Metered AI API keys need spend limits and per-feature switches":
- the Test button makes a real call to prove the key and model;
- each provider has an on/off switch;
- chat requests are rate-limited.

## Checks

| Run | Result |
|---|---|
| Verifier, first run | **fail**: `ruff format --check` flagged `backend/app/agent/registry.py`, which was edited after the last format. The other 6 checks passed: backend 119 tests, mypy, frontend 54 tests, oxlint, build, e2e 7 tests. |
| After `ruff format` | ruff check and format check are clean. The code is otherwise unchanged; the only other edit is a tooltip on the disabled switch. |

## Security checks (from the verifier)

| Property | Evidence |
|---|---|
| No key returned by the API | `test_key_is_never_returned_and_stored_encrypted` checks that the PUT and GET responses contain neither the key nor its tail; only `…1234` is returned. `test_app_key_overrides_env_and_remove_falls_back` covers env keys. |
| Keys stored encrypted | `api_key_enc` is a Fernet token, and the test reads the raw row to confirm the key is not in it. An unreadable token is reported rather than crashing (`test_unreadable_saved_key_is_reported`). |
| Tests never call a real provider | A fake client factory is used. Settings strip real keys. The e2e suite saves a dummy key and never presses Test. |
| Spend control | The on/off switch is covered by `test_switch_off_keeps_key_and_refuses_chat`. The 429 rate limit is covered by `test_chat_over_the_limit_is_429_and_calls_nothing`. |

## Problems found and fixed

| What went wrong | Caught by | Fix |
|---|---|---|
| The model list mixed the catalog with the custom model, which made the select logic convoluted | Main session review while writing the page | The API returns only catalog models; the UI adds the chosen model to the list |
| The e2e backend started before the test DB had `provider_configs` | Playwright web-server log | This is by design: startup logs a warning and keeps working with `.env` keys only. Global setup then migrates. |
| `registry.py` was not formatted | Verifier | `ruff format` |
| A disabled "On" switch had no explanation | qc-ui (minor) | Tooltip "Save a key first" |

Two minor qc-ui findings were left as they are: the "Saved." note duplicates the status line, and one screenshot caught the transient "Loading your notes…" state.

## UI QC report (qc-ui, sonnet)

Verdict: **pass**. 11 of 11 screenshots were inspected. `settings-saved.png` matches the provider-settings spec: provider cards, a status line with the hint, the masked key field, a model select with the default marked, Save/Test/Remove buttons, and the `.env` alternative. No key text appears anywhere.

## Not verified

- A real call with a real key. No key exists on this machine. The owner's first **Test** press in Settings is that check.
