# Change: Lesson markers on the roadmap map

## Why

The map marks a node only with its note count. A node whose lesson was written (by the owner or the lesson writer) looks exactly like an empty node, so the owner saw a topic of Ô tô hạng B with a drafted lesson and no mark (2026-11-15, `#/roadmap/o-to-hang-b`). The map should show at a glance where learned content sits, and a lesson is learned content.

## What changes

- `GET /api/domains/{domain}/counts` also returns `lessons`: the node ids (short ids, as in `counts`) that have a lesson for the current user. The note counts stay as they are.
- Every node with a lesson is visibly marked on the map with a lesson mark (icon, accessible name "Has a lesson") and the same highlight as a node with notes; the note count badge stays separate, so a node can carry both.
- The mark appears without a reload after a lesson is saved or cleared on the lesson page, and after the agent writes a lesson (the chat already refreshes the counts).

## Impact

- Spec: `learning-views` (Roadmap map with note markers).
- Backend: `routes/domains.py` (`read_counts`), `schemas.py` (`NodeCounts.lessons`), tests `test_linking.py`, `test_learning_fields.py`, `test_isolation_notes.py`.
- Frontend: `api.ts`, `lib/layout.ts`, `RoadmapMap.tsx`, `LessonPage.tsx` (refresh counts after save), `index.css`, `test/fakeApi.ts`, `RoadmapMap.test.tsx`, `LessonPage.test.tsx`; e2e.
- Backup/restore: unchanged (lessons are already in the archive).
