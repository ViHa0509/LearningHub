# Design

## API

`GET /api/domains/{domain_id}/counts` → `NodeCounts`:

```json
{ "domain": "backend", "counts": { "caching": 2 }, "lessons": ["caching", "auth"] }
```

- `lessons`: short node ids (the part after `domain/`) of the domain's nodes that have a `Lesson` row for the current user (`Lesson.user_id == user.id`, `Lesson.node_id in known`), sorted, no duplicates. A lesson row exists only with a non-empty body (an empty PUT deletes it), so existence is the test. Nodes removed from the roadmap are left out (same `known` filter as the notes).
- Shared areas (read-only for a member): the member's own lessons count, as for notes.
- Unknown domain: 404 as today.

## Frontend

- `api.ts`: `NodeCounts.lessons: string[]`.
- `lib/layout.ts`: `layoutRoadmap(roadmap, counts, lessons: ReadonlySet<string> | string[], selectedNode)` → `RoadmapNodeData.hasLesson: boolean`.
- `RoadmapMap.tsx` `RoadmapNodeView`: class `has-lesson` when `hasLesson`; a mark `<span className="lesson-mark" role="img" aria-label="Has a lesson"><Icon name="lesson" /></span>` before the note badge. A node with a lesson or notes gets the highlighted border and background (`.roadmap-node.has-notes, .roadmap-node.has-lesson`).
- `LessonPage.tsx` `save`: after `setQueryData` of the lesson, `client.invalidateQueries({ queryKey: ['counts'] })` so the map shows or drops the mark (the body may have been cleared).
- `useAgentChat.ts` already invalidates `['counts']` for `changed_lessons`: no change.
- `index.css`: `.lesson-mark` 16 px icon in `var(--has-notes)`; node layout keeps title, mark and badge on one row (`NODE_WIDTH` 190, title ellipsis).
- `test/fakeApi.ts` counts route: `lessons` = keys of `state.lessons` under `${domain}/` with a non-empty body, short ids.

## Tests

- Backend `test_linking.py`: counts answer includes `lessons: []` with no lesson; a lesson on `backend/auth` and another user's lesson on `backend/caching` → own answer lists only `auth`; clearing the lesson removes it. Existing exact-equality assertions on the counts JSON gain `"lessons": []`.
- Vitest `RoadmapMap.test.tsx`: a node with a lesson shows the mark and the class; a node with notes and a lesson shows both; nodes without either show neither. `LessonPage.test.tsx`: saving a lesson invalidates the counts (the fake API's counts then list the node).
- E2E: write a lesson on a node from the lesson page, go to the map, the node shows "Has a lesson"; clear it, the mark is gone; a note count and a lesson mark on the same node.
