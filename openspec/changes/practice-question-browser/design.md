# Design

## Data (migration 0018)

- `question_answers.last_choice` int, nullable (1-based option; null for rows written before this change and for test answers left blank).
- `question_bookmarks` (`user_id` fk users CASCADE, `question_id` fk questions CASCADE, `created_at`), pk (user_id, question_id). RLS like every public table (`alembic/env.py`).
- A practice answer (`POST /api/questions/{id}/answer`) stores `last_choice`; a submitted test stores each answered question's choice too (`exam.py` scoring already updates `question_answers`).

## API (adds to `openspec/changes/practice-exams/api.md`)

| Route | Request | Answer |
|---|---|---|
| `GET /api/banks/{id}/questions?topic=&critical=true&wrong=true&bookmarked=true` | filters optional, combinable | `200 [QuestionOut]` ordered by number |
| `PUT /api/questions/{id}/bookmark` | `{bookmarked: bool}` | `200 {bookmarked}`; idempotent; 404 for a question the user cannot see |

- `QuestionOut` gains `last_choice: int | null` and `bookmarked: bool` (never the answer).
- `BankOut` gains `bookmarked_count: int` (the user's own) so the tab can show a count without loading every question.

## Backup

- `BankAnswerRow` gains `last_choice: int | null = None` (an older archive restores with null).
- `BankRow` gains `bookmarks: list[int] = []` (question numbers of the user's bookmarks).
- Restore validates both like the rest of the archive before writing anything.

## Frontend

- `#/practice/<area>` keeps the bank picker and "Start a test"; below them the browser:
  - `role="tablist"` **Sets**: All, each topic (title, count), Critical, Got wrong, Bookmarked. Got wrong and Bookmarked are enabled only when they hold a question.
  - `nav` **Questions**: one `button` per question of the set, text = bank number, classes `right` / `wrong` / `critical` / `current`, `aria-label` "Question 12, right, critical" (state words only when they apply). Colours: `--has-notes` green, a new `--warn` yellow pair (`--warn`, `--warn-soft`) in both themes, `--danger` red mark (left border or ring) for critical.
  - The card: `QuestionCard` with a **Bookmark** toggle button (`aria-pressed`) in its header, then the `flow-nav` row: Previous, Check, Next, Shuffle. Shuffle reorders the set once (Fisher-Yates) and goes to its first question; the grid keeps bank numbers.
  - A question with `last_choice` opens with that option selected and marked right or wrong (the correct option is not known until Check is pressed again); Check stays enabled, and a new answer replaces the state in the grid at once (the questions query is updated in place, then invalidated).
  - Desktop (>= 900 px): grid left (fixed width, scrolls), card right. Phone: grid above the card, at most ~40 % of the viewport high, scrollable.
- Area map page: for an area with `field_id`, the Practice link always shows; it leads to `#/practice/<area>`, which without a bank shows "This area has no question banks yet." and, for the owner, the Import questions button (same `importBank` flow as the map page, moved into a small shared component).

## Testing

- Backend: `test_question_banks.py` cases for `last_choice`, the bookmark route (toggle, idempotent, another user's question 404), the `bookmarked` filter, `bookmarked_count`; `test_data_backup_banks.py` round trip with a choice and a bookmark; `test_migrations_practice.py` for 0018.
- Frontend Vitest (`Practice.test.tsx`): tabs, grid colours, shuffle, bookmark, saved answer on return, no-bank page with import for the owner.
- E2E (qc-e2e) from the spec scenarios with the synthetic fixture bank.
