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

## agent-learned-notes
- Tasks 1.1, 1.2, 2.1, 3.1 have evidence: migration `0016_note_source.py`; `backend/tests/test_learned_notes.py` (New topic, Already known, HTML in the write-up); `LearnedList.test.tsx` (Newest first, badge); `frontend/e2e/agent-learned-notes.e2e.ts`.
- Uncovered scenarios: none.
