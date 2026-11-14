# Proposal

## Why

Some fields are learned by drilling questions: the car driving licence (a 600-question theory bank, mock tests of randomly drawn questions with a time limit, a pass mark and critical questions that fail the test on their own), and self-tests for BA, PM or cloud certifications. The owner pointed at laixehub.com as the experience to aim for (2026-11-14). Its terms of use claim the 600-question data and forbid copying it, so the app imports a bank from a file the user is allowed to use and never scrapes a site.

## What Changes

- **Question banks per area.** An area (change `learning-fields`) can hold question banks. A bank is imported from a JSON file (optionally a zip with the images): title, exam rules, and questions with their topic (chapter), text, 2 to 6 options, the correct option, a critical flag, an optional image and an optional explanation. Import is checked fully before anything is stored.
- **Practice by topic.** The user goes through the questions of a topic, or of the critical questions, one at a time; choosing an option shows right or wrong and the explanation. Progress per question (last answer right or wrong) is kept.
- **Mock exam.** "Start a test" draws questions by the bank's rules: number of questions, optional count per topic, at least N critical questions; a countdown of the bank's minutes; submit or time out; the result shows score, pass or fail by the pass mark, and fail when a critical question is wrong if the bank says so; then a review of every question.
- **Wrong answers and history.** A "Got wrong" list to practise again, and the list of past tests with score and pass/fail.
- Banks follow the area's visibility: a bank in a published field is available to every account; answers and tests are each user's own.
- Rules are data in the bank file; the app has no built-in numbers for any licence.

Not in this change: generating questions with the agent, the 3D/simulation part of the driving test, editing questions in the app (re-import replaces a bank).

## Capabilities

### New Capabilities
- `practice-exams`: question banks, practice, mock exams, history.

### Modified Capabilities
- `data-sync`: backup and restore cover the user's banks (with images), answers and tests.

## Impact

- Backend: tables `question_banks`, `questions`, `question_answers`, `exam_attempts` (migration 0016); images stored through the file store; routes `/api/areas/{slug}/banks`, `/api/banks/{id}/...`.
- Frontend: Practice and Test pages for an area, linked from the area map page.
- Tests: import validation, drawing by rules (seeded), scoring and critical rule, isolation, Vitest, e2e with a small synthetic bank (no real exam data in the repo).
