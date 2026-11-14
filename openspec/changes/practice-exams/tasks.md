# Tasks

Depends on `learning-fields` (areas and topics).

## 1. Backend

- [ ] 1.1 Models and migration `0016_practice_exams.py`; verify with `test_migrations.py` cases
- [ ] 1.2 Import (JSON or zip) with full validation; verify with `test_question_banks.py` for "Import a question bank"
- [ ] 1.3 Practice answer, test draw, submit, scoring, history (design: Drawing a test); verify with tests for every scenario of "Practice by topic", "Mock exam by the bank's rules" (seeded random), "Test history and access"
- [ ] 1.4 Backup and restore; verify with `test_data_backup.py` cases

## 2. Frontend

- [ ] 2.1 Practice page (topics, critical, got wrong, one-question flow); verify with Vitest
- [ ] 2.2 Test page (palette, countdown, submit/confirm, time out, result and review) and history; verify with Vitest (fake timers)

## 3. E2E and integration

- [ ] 3.1 e2e with a synthetic bank file in `e2e/fixtures` (made-up questions, no real exam data): import, practise, pass a test, fail on a critical question, history; screenshots light/dark and phone; `npm run e2e` passes
- [ ] 3.2 Every check in `CLAUDE.md` passes, `openspec validate practice-exams --strict` passes; verifier report
