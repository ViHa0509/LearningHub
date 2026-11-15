# Tasks

## 1. Frontend

- [x] 1.1 `NoteView.tsx`: "Linked to" label on the picker, pending node with Save link / Cancel link change (nothing saved on change or blur, Escape cancels), Open lesson link for an existing saved node, CSS for the label and link; update and extend `NoteView.test.tsx` for every scenario of "Read a note" that touches the link; verify with `npm test`, `npm run lint`, `npm run build`

## 2. E2E and verification

- [x] 2.1 qc-e2e: `note-edit.e2e.ts` scenario for change without save, Cancel, Save + reload, Open lesson; `curation.e2e.ts` one-line header test with the new name; `npm run e2e` passes (at least `note-edit`, `curation`, `app`, `members` locally)
- [x] 2.2 Every check in `CLAUDE.md` passes, `openspec validate note-link-picker --strict` passes; verifier report
