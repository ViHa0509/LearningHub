# Proposal: practice-question-browser

## Why

The practice page (practice-exams) lists the sets and then shows one question at a time with Previous/Next. The owner practises the class B driving theory (600 questions, 6 chapters, 60 critical) and wants the layout of the theory sites they know: the sets as tabs across the top, a grid of every question number of the set coloured by their own state, and the question beside it. They also want their work kept: which questions they answered, with what, and which were right, on every device, and a way to mark questions to come back to.

The hosted app already serves the practice UI (checked in the deployed bundle on 2026-11-15); the owner saw no practice UI because an area shows "Practice" only once a bank is imported, and the import action sits on the area map page. The entry is made plain.

## What Changes

- The practice page becomes a question browser: tabs **All**, one per topic, **Critical**, **Got wrong**, **Bookmarked**; a grid of the set's question numbers; one question card.
- Each number shows the user's state: **green** last answer right, **yellow** last answer wrong, plain not answered; a **critical** question carries a red mark in every state; the current question is outlined.
- The card has **Bookmark** (toggle), **Shuffle** (random order of the set), **Previous**, **Next**, **Check**.
- Answers are saved with the chosen option (`last_choice`); a question answered before opens showing the chosen option and whether it was right; answering again replaces it.
- Bookmarks per user (new table), in the backup.
- The area page of a learning-field area always shows **Practice**; without a bank the practice page says so and, for the owner, offers **Import questions** there.

## Capabilities

### Modified Capabilities
- `practice-exams`: Practice by topic becomes the question browser; saved answers and bookmarks added.
- `data-sync`: the backup carries the chosen option and the bookmarks.

## Impact

- Migration `0018_practice_marks.py`: `question_answers.last_choice`, table `question_bookmarks`.
- Backend: `routes/practice.py`, `practice/schemas.py`, `db.py`, `data_sync/backup.py`, `data_sync/restore.py`; tests.
- Frontend: `PracticePage.tsx`, `QuestionCard.tsx`, `RoadmapMap.tsx`, `api.ts`, `test/fakeApi.ts`, `index.css`; Vitest; e2e `practice-exams.e2e.ts` (the "Practice" link now shows without a bank: two assertions of that file change).
- Out of scope: the mock test page (`ExamPage`) keeps its palette; question data is never copied from any practice website (the owner's bank comes from the official Cục CSGT documents).
