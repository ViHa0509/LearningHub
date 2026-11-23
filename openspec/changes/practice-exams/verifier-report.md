# Verifier report: pass

Run by `ai-sdlc-kit:verifier` on 2026-11-23, one run shared by agent-learned-notes, learning-fields, practice-exams, chat-session-history, ci-cd and agent-stop (working tree before commit).

| Command | Exit | Result |
|---|---|---|
| `cd frontend && npm test` | 0 | pass (56 files, 712 tests) |
| `cd frontend && npm run lint` | 0 | pass |
| `cd frontend && npm run build` | 0 | pass |
| `cd backend && ruff check . && ruff format --check .` | 0 | pass |
| `cd backend && mypy app` | 0 | pass (103 files) |
| `cd backend && python -m pytest` | 0 | pass (1311 passed, 24m41s) |
| `cd frontend && npm run e2e` | 0 | pass (381 passed, 34 skipped by design in phone/tablet projects, 22.6m) |
| `openspec validate <change> --type change --strict` | 0 | pass for all six |

## practice-exams
- Tasks 1.1-3.1 have evidence: migration `0017_practice_exams.py`; `test_question_banks.py`, `test_exams.py`, `test_data_backup_banks.py`; `frontend/e2e/practice-exams.e2e.ts`.
- Uncovered scenarios: none.
