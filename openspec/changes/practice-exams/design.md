# Design

## Bank file (import)

```json
{
  "title": "Car licence class B theory",
  "rules": {
    "questions": 30, "minutes": 20, "pass_mark": 27,
    "critical_fails": true, "min_critical": 1,
    "per_topic": {"chuong-1": 8}
  },
  "questions": [
    {"number": 1, "topic": "chuong-1", "text": "...", "options": ["...", "..."],
     "answer": 2, "critical": true, "image": "q1.png", "explanation": "..."}
  ]
}
```

- `answer` is 1-based. `topic` must be a topic slug of the area. Numbers unique, 1..N. `image` names a file in the zip (PNG, JPEG, WebP; at most 2 MB each); `rules.questions` <= questions available; `per_topic` sums to at most `questions`; text lengths capped (question 2000, option 500, explanation 2000), at most 2000 questions and 50 MB per import.
- The numbers in `rules` are whatever the source says; the example values are illustrative only.

## Data model (migration 0016)

- `question_banks`: id, area_id fk CASCADE, title, rules jsonb, question_count, created_at.
- `questions`: id, bank_id fk CASCADE, number, topic_slug, text, options jsonb, answer int, critical bool, image_key nullable (file store, content-addressed like note files), explanation.
- `question_answers`: user_id, question_id, last_correct bool, times_wrong int, answered_at (pk user+question).
- `exam_attempts`: id, user_id, bank_id, question_ids jsonb (drawn order), answers jsonb, started_at, deadline, submitted_at, score, passed, failed_on_critical.

## Drawing a test

Server side, so the answers are never sent before the end: `POST /api/banks/{id}/exams` draws per `per_topic` first, then fills from the rest; ensures `min_critical`; shuffles question order; returns the questions without answers and the deadline. `POST /api/exams/{id}/submit {answers}` (accepted until deadline + 30 s grace; later answers count as unanswered) scores, applies `critical_fails`, stores the attempt and updates `question_answers`, and returns the review with correct answers and explanations. Practice answers use `POST /api/questions/{id}/answer {choice}` and return right/wrong with the explanation.

## Access

Bank visibility = its area's visibility (own field or published field). Import and delete: area owner only. Answers and attempts: per user; another user's attempt is 404.

## Frontend

Area map page gets "Practice" when the area has a bank: `#/practice/<area>` (bank picker, topic list with counts and progress, Critical, Got wrong, Start a test) and `#/exam/<id>` (one question at a time with a palette of numbers, countdown, Submit with confirm; result and review). Images are served by an authenticated route and shown in an `<img>`; text is rendered as plain text.
