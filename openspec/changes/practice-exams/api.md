# API contract (practice-exams)

Every route needs a signed-in session; mutating ones need `X-LearningHub: 1`. A bank is visible to whoever sees its area (own field or published field); import and delete are for the area's owner (403 otherwise, 404 when the area is not visible). Answers and exams are per user; another user's exam is 404. Migration number: `0017_practice_exams.py` (0016 is taken).

| Route | Request | Answer |
|---|---|---|
| `GET /api/areas/{slug}/banks` | | `200 [BankOut]` |
| `POST /api/areas/{slug}/banks` | multipart, field `file`: `.json` or `.zip` (zip holds one `.json` and an `images/` folder or images next to it) | `201 BankOut`; `422 {detail: [{question: number or null, msg}]}` naming every problem found (first 50); `413` over the size limit |
| `DELETE /api/banks/{id}` | | `204` |
| `POST /api/banks/{id}/images` | multipart, field `files` (repeatable): image files and/or zips of images, one request at most 4 MB (the client sends batches) | `200 {added: [names], unknown: [names], missing: int}`; names matched to the questions' `image` field; owner only |
| `GET /api/banks/{id}/questions?topic=<slug>&critical=true&wrong=true` | filters optional, combinable | `200 [QuestionOut]` ordered by number |
| `GET /api/questions/{id}/image` | | the image bytes with its content type; `404` without image |
| `POST /api/questions/{id}/answer` | `{choice: int (1-based)}` | `200 {correct, answer, explanation}`; records `last_correct` and `times_wrong` |
| `POST /api/banks/{id}/exams` | | `201 ExamOut` (unfinished) |
| `GET /api/exams/{id}` | | `200 ExamOut` (unfinished: questions, deadline, saved answers; finished: also result and review) |
| `PUT /api/exams/{id}/answers` | `{answers: {"<question id>": choice}}` | `200` saves progress (so a reload keeps the answers); `409` when finished |
| `POST /api/exams/{id}/submit` | `{answers: {"<question id>": choice}}` | `200 ExamOut` finished; after deadline + 30 s the stored answers are scored and later ones ignored |
| `GET /api/banks/{id}/exams` | | `200 [ExamSummary]` newest first |

Shapes:

- `BankOut = {id, area, title, rules: {questions, minutes, pass_mark, critical_fails, min_critical, per_topic}, question_count, critical_count, topics: [{slug, title, count}], images_missing: int, created_at}`
- `QuestionOut = {id, number, topic, text, options: string[], critical, has_image, last_correct: boolean | null}` (never the answer)
- `failed_on_critical` is filled only when the bank's `critical_fails` is true; otherwise it is `[]`.
- `ExamOut = {id, bank_id, started_at, deadline, submitted_at: string | null, questions: QuestionOut[] (in drawn order, last_correct null), answers: {"<question id>": int}, result: null | {score, total, passed, failed_on_critical: number[] (question numbers), review: [{question_id, number, choice: int | null, answer, correct, explanation}]}}`
- `ExamSummary = {id, started_at, submitted_at, score, total, passed}` (`score`/`passed` null while unfinished)

Frontend routes: `#/practice/<area slug>` (banks of the area, topics with counts and progress, Critical, Got wrong, Start a test, history) and `#/exam/<exam id>`. The area map page shows a "Practice" link when the area has at least one bank, and an "Import questions" action for the owner.
