# Verifier report (2026-11-15, `ai-sdlc-kit:verifier`, one run for three changes)

Changes verified together in the same working tree: `practice-question-browser`, `users-menu-further-reading`, `lesson-writer-long-output`. Verdict for each: **PASS**.

## Checks

| Command | Exit | Result |
|---|---|---|
| `cd backend && .venv/Scripts/python -m pytest` | 0 | 939 passed in 886.77 s |
| `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .` | 0 | All checks passed; 166 files already formatted |
| `cd backend && .venv/Scripts/mypy app` | 0 | no issues in 84 source files |
| `cd frontend && npm test` | 0 | 35 files, 469 tests passed |
| `cd frontend && npm run lint` | 0 | no problems |
| `cd frontend && npm run build` | 0 | tsc -b and vite build succeeded (chunk-size warning only) |
| `cd frontend && npm run e2e` | 0 | 248 passed, 30 skipped (viewport-only tests), 16.1 min |
| `openspec validate <change> --strict` (each of the three) | 0 | valid |

## practice-question-browser

Tasks 1.1-1.3, 2.1-2.2, 3.1 have evidence: `0018_practice_marks.py` + `test_migrations_practice.py::test_0018_adds_the_chosen_option_and_bookmarks_and_its_downgrade_removes_them`; `test_question_banks.py` (`test_the_chosen_option_comes_back_and_a_new_answer_replaces_it`, `test_a_submitted_test_stores_the_choice_of_each_answered_question`, `test_bookmark_toggle_filter_and_count`, `test_bookmark_needs_the_app_header_and_a_valid_body`, `test_bookmarks_are_per_user_and_an_invisible_question_is_404`); `test_data_backup_banks.py` (`test_the_chosen_option_and_the_bookmark_are_in_the_archive_and_come_back`, `test_an_archive_from_before_the_choice_and_bookmarks_restores_without_them`); `Practice.test.tsx` (tabs, grid colours, critical mark, shuffle, bookmark, answered question on return, area without a bank x3); `ImportBank.tsx`; `practice-exams.e2e.ts`.

Scenario -> tests: Answer a question (Vitest + e2e "Practice a wrong answer"); Colours of the grid (Vitest x2 + e2e); Shuffle (Vitest + e2e); Come back to an answered question (Vitest + e2e reload); Answer again (Vitest + e2e); Bookmark and unbookmark (Vitest + e2e + backend); Another user's bookmark (backend + e2e); Area without a bank (Vitest owner/member + e2e); data-sync Round trip (backend round-trip tests).

Deviations: none. Note: "on any device" is covered by a reload and the server-side round trip, not a second browser.

## users-menu-further-reading

Tasks 1.1, 1.2, 2.1 have evidence: `UsersSettings.tsx` + `Users.test.tsx` row test (no menu on the own row, Disable and Delete in the menu, confirm asked); `LessonPage.tsx:109` (`field_id === null`) + `LessonPage.test.tsx` "shows no roadmap.sh link on a lesson of a learning field area"; `members.e2e.ts` (disable, enable, delete through the menu); `learning-fields.e2e.ts:304` "Further reading: a built-in role links to roadmap.sh, a field area does not".

Scenario -> tests: Row actions menu (Vitest + e2e); Disable a member, Delete a member, Members cannot manage users (existing e2e + backend); Link to roadmap.sh (e2e); No link on a field area (Vitest + e2e).

Deviations: none. Weakness: the Vitest "no link" test uses a 50 ms sleep.

## lesson-writer-long-output

Tasks 1.1-1.3, 2.1 have evidence: `messages.py` (`Turn.truncated`), `adapters.py` (`ANTHROPIC_DEFAULT_MAX_TOKENS = 8192`, `stop_reason == "max_tokens"`, `finish_reason == "length"`) + `test_llm_adapters.py` (`test_anthropic_marks_an_answer_cut_by_max_tokens`, `test_openai_marks_an_answer_cut_by_length`, `test_anthropic_sends_only_set_parameters_and_a_default_max_tokens`); `loop.py` + `test_agent_chat.py` (`test_cut_tool_call_is_not_run`, `test_cut_text_answer_ends_with_the_note`, `test_same_failing_call_three_times_stops_the_run`, `test_call_cut_every_step_stops_after_three_steps`, `test_lesson_writer_names_both_search_cases`); `lesson-writer.e2e.ts` + `fake_llm.py` (`[[cut]]`, `[[cut-text]]`).

Scenario -> tests: Cut tool call (unit + e2e); Cut text answer (unit + e2e); Same failing call three times (unit x2); New area with search on / off (instruction-level unit test only: the model's search is not deterministic, as task 1.3 states).

Deviations: the two "New area" scenarios are covered at the instruction level only.
