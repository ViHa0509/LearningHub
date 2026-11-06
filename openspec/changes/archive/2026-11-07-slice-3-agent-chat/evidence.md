# Evidence log: slice-3-agent-chat

Built 2026-11-07 by Claude Code (autonomous). Owner feedback addressed: "Agent is not running yet". Who did what is logged in `.sdlc/log.md`.

## What runs and what does not yet

| Part | State |
|---|---|
| Providers, tool loop, tools, chat API | Built and tested offline with a scripted fake provider (no network) |
| Chat panel, Draft with agent | Built; configured states tested in Vitest, not-configured state in e2e |
| Live agent against a real model | **Not run**: no provider key on this machine. Needs `LH_ANTHROPIC_API_KEY` (or another provider) in `backend/.env` |
| Golden-question evals (6) | Present; skipped without a key (`pytest evals -m live`: 6 skipped) |
| Model ids for OpenAI, DeepSeek, Ollama | Not verified (no keys); a wrong id surfaces as a provider error in the panel |

## Security checks

| Risk | Control | Test |
|---|---|---|
| Prompt injection from imported pages | Note text only inside `<untrusted_note_content>`, system prompt says it is data; note titles kept out of the system prompt | `test_read_note_wraps_text_as_untrusted`, `test_describe_page_keeps_note_titles_out`; eval `prompt-injection-in-note` (live) |
| Agent destroys user work | No delete tools; `write_lesson` refuses user-written lessons | `test_write_lesson_rules`, `test_tool_errors_are_results[delete_lessons]`; eval `protected-user-lesson` (live) |
| Key leaks | `SecretStr` settings, providers API returns setting names only; tests and e2e force no provider | `test_list_providers_one_available_without_key`, `test_build_providers_only_for_configured_settings` |
| HTML in model output | Answers rendered with react-markdown without raw HTML | AgentPanel test asserts no `<script>` in the log |
| LIKE wildcards in search | `%` and `_` escaped | `test_search_notes_matches_title_and_text_with_snippet` |

## Problems found and fixed

| What went wrong | Caught by | Fix |
|---|---|---|
| A blank `LH_*_API_KEY=` counted as configured (`SecretStr('')` is truthy) | Designing the e2e environment (must run with no provider) | `_secret()` treats blank as unset; test added |
| `useEffect` for agent requests missed `send` in its dependencies | oxlint `react-hooks/exhaustive-deps` | `useEffectEvent` |
| `e2e/global-setup.ts` imported `../playwright.config` without extension under `nodenext` | `tsc -b` | Import with `.ts` |
| Empty lesson said "ask the agent to draft it" while no provider was configured | qc-ui agent (minor) | Agent hint shown only when a provider is available |

Kept as minor (qc-ui): agent panel header alignment; a "Loading your notes..." frame caught in one screenshot (timing).

## UI QC report (qc-ui, sonnet)

```
## UI QC report: pass
| e2e: cd frontend && npm run e2e | pass | exit 0, 6 of 6 tests passed in 37.1s |
| Screenshots inspected | 10 of 10 | frontend/e2e-results/screens/ at 1440x900 |
Findings: 3 minor (see above). Configured chat states are covered by Vitest only.
```

The QC report also said that the suite does not record console errors. That is not correct: each e2e test fails on any page or console error (`watchErrors` in `frontend/e2e/app.e2e.ts`).

## Verifier report (verifier, sonnet)

Verdict: **pass**. All seven CLAUDE.md checks exit 0 (backend 101 tests, frontend 47, e2e 6). Tasks 1.1-4.1 have evidence. Uncovered scenarios: none. The "Run with a key" and "Protected lesson eval" evals exist but are unverified without a key. The step-limit test is tied to the default of 6 steps.
