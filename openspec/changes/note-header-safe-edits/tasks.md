# Tasks

## 1. Frontend

- [x] 1.1 `NoteView.tsx`: title as a heading, Rename button and More actions → Rename opening the title field with Save title / Cancel title change (Enter saves, Escape cancels, blur does nothing), undo line after a rename and after Save link with Undo, CSS; `NoteView.test.tsx` for every scenario of "Read a note" that touches the title or Undo; verify with `npm test`, `npm run lint`, `npm run build`

## 2. E2E and verification

- [x] 2.1 qc-e2e: `note-edit.e2e.ts` rename flow through Rename, new Undo test (rename and link), `curation.e2e.ts` one-line header with the heading; any other e2e that fills the "Note title" textbox; `npm run e2e` passes
- [x] 2.2 Every check in `CLAUDE.md` passes, `openspec validate note-header-safe-edits --strict` passes; verifier report
