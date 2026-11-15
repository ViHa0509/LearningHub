# Tasks

Depends on `practice-exams` (shipped). Contract: `design.md` here plus `openspec/changes/practice-exams/api.md`.

## 1. Backend

- [x] 1.1 Migration `0018_practice_marks.py` (`question_answers.last_choice`, `question_bookmarks`, RLS) and models in `db.py`; verify with `test_migrations_practice.py`
- [x] 1.2 `last_choice` recorded by practice answers and test submits; `bookmarked`, `last_choice` in `QuestionOut`; `bookmarked_count` in `BankOut`; `bookmarked=true` filter; `PUT /api/questions/{id}/bookmark`; verify with `test_question_banks.py` for every scenario of "Saved answers" and "Bookmarks"
- [x] 1.3 Backup and restore of `last_choice` and bookmarks (older archives restore with none); verify with `test_data_backup_banks.py`

## 2. Frontend

- [x] 2.1 Question browser on the practice page: set tabs, number grid with colours and the critical mark, shuffle, bookmark, saved answer shown on return, `api.ts` and `fakeApi.ts` for the new fields and route, `--warn` colours in both themes; verify with Vitest (`Practice.test.tsx`)
- [x] 2.2 Practice link always for a field area; practice page without a bank: message and the owner's Import questions (shared with the area page); verify with Vitest; update the two "Practice link has count 0" assertions in `e2e/practice-exams.e2e.ts`

## 3. E2E and verification

- [x] 3.1 qc-e2e from the spec scenarios with the synthetic fixture bank (colours, shuffle, bookmark, saved answer, empty area); screenshots light/dark and phone; `npm run e2e` passes
- [x] 3.2 Every check in `CLAUDE.md` passes, `openspec validate practice-question-browser --strict` passes; verifier report
