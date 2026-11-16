# Tasks

## 1. Frontend

- [x] 1.1 `lib/grouping.ts`: `groupNotes` option `allTopics` (design, decision 3); `LearnedList.tsx`: draggable note rows, topic groups and Unsorted as drop targets, empty topics and empty Unsorted while dragging, drop links through `api.link`, the shared undo line with Undo for a move (design, Behaviour); CSS for `drop-target` and the "Drop here" line in `index.css` (light and dark); `grouping.test.ts` and `LearnedList.test.tsx` for every new scenario of "Learned-items list"; verify with `npm test`, `npm run lint`, `npm run build`

## 2. E2E and verification

- [x] 2.1 qc-e2e: `curation.e2e.ts` drag a note from Unsorted onto a topic without notes of a listed domain, Undo, drag a linked note onto Unsorted, drop on the own topic; `npm run e2e` passes
- [x] 2.2 Every check in `CLAUDE.md` passes, `openspec validate learned-list-drag-drop --strict` passes; verifier report
