# Verifier report (2026-11-16, `ai-sdlc-kit:verifier`)

Verdict: **PASS**.

## Checks (one run for four changes: map-lesson-markers, chat-new-on-load, note-header-safe-edits, agent-settings-page)

| Command | Exit | Result |
|---|---|---|
| `cd backend && .venv/Scripts/python -m pytest` | 0 | 966 passed in 540 s |
| `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .` | 0 | All checks passed; 170 files already formatted |
| `cd backend && .venv/Scripts/mypy app` | 0 | no issues in 84 source files |
| `cd frontend && npm test` | 0 | 36 files, 496 tests passed |
| `cd frontend && npm run lint` | 0 | no problems |
| `cd frontend && npm run build` | 0 | tsc -b and vite build succeeded (chunk-size warning only) |
| `cd frontend && npm run e2e` | 0 | 266 passed, 30 skipped (viewport-only tests), 13.3 min |
| `openspec validate <change> --strict` (each of the four) | 0 | valid |

## Scenario -> tests

| Scenario | Test |
|---|---|
| Marked nodes | existing map tests; `curation.e2e.ts` "Roadmap map markers ignore archived notes" |
| Node with a lesson | `test_linking.py::test_counts_list_nodes_with_a_lesson`; `RoadmapMap.test.tsx` "marks a node with a lesson and leaves the others unmarked"; `map-lesson-markers.e2e.ts` |
| Notes and a lesson on one node | `RoadmapMap.test.tsx` "shows the note badge and the lesson mark on one node"; e2e |
| Lesson mark follows the lesson | `test_clearing_a_lesson_removes_its_marker`; `LessonPage.test.tsx` "invalidates the map counts after a lesson is saved"; e2e (save and clear from the lesson page) |
| Lessons are per user | `test_linking.py::test_counts_lessons_are_per_user` |
| Switch domain | existing test |

Deviations: none.
