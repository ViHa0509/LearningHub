# Tasks

Contract: `design.md`.

## 1. Backend

- [x] 1.1 `NodeCounts.lessons` and `read_counts` listing the current user's lessons of the domain's nodes; update the exact-equality assertions on the counts JSON; new tests in `test_linking.py` for "Node with a lesson" (API side), "Lessons are per user" and a cleared lesson; verify with pytest `test_linking.py test_learning_fields.py test_isolation_notes.py test_archive.py`, ruff, mypy

## 2. Frontend

- [x] 2.1 `api.ts`, `lib/layout.ts` (`hasLesson`), `RoadmapMap.tsx` (class `has-lesson`, mark "Has a lesson"), `index.css`, `LessonPage.tsx` (invalidate counts after save), `test/fakeApi.ts` (`lessons` in the counts answer); Vitest `RoadmapMap.test.tsx` for "Node with a lesson", "Notes and a lesson on one node" and unmarked nodes, `LessonPage.test.tsx` for the refresh after save; verify with `npm test`, `npm run lint`, `npm run build`

## 3. E2E and verification

- [x] 3.1 qc-e2e: map scenarios "Node with a lesson", "Notes and a lesson on one node", "Lesson mark follows the lesson" (save and clear from the lesson page); screenshots `map-lesson-mark` light and dark; `npm run e2e` passes
- [x] 3.2 Every check in `CLAUDE.md` passes, `openspec validate map-lesson-markers --strict` passes; verifier report
