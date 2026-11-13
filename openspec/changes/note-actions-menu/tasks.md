# Tasks

## 1. Shared menu

- [x] 1.1 `components/ActionMenu.tsx`: the menu behaviour of `NoteMenu` in `LearnedList.tsx` (focus on the first item, Up and Down wrap, Escape closes and returns focus, outside click closes, a click on its own trigger is left to the trigger) taking its items as children; `LearnedList` uses it with the same items, names and classes; verify `LearnedList.test.tsx` passes unchanged and a new `ActionMenu.test.tsx` covers the four behaviours

## 2. Note page

- [x] 2.1 `NoteView`: a More actions button (`aria-label="More actions"`, `aria-haspopup="menu"`, `aria-expanded`, vertical three-dot icon; add it to `Icon.tsx` if `more` is horizontal) replacing the four header buttons, with menu items Edit page, Export PDF (still a link to the print view in a new tab, `role="menuitem"`), Archive or Restore, a divider and Delete; Delete closes the menu and shows the existing confirmation in the header; only Archive or Restore and Delete while editing; verify with Vitest in `NoteView.test.tsx` for the four new scenarios of "Read a note" and with the existing cases changed to open the menu first, none removed or weakened
- [x] 2.2 Styles in `index.css`: menu anchored under the button at the right edge without causing sideways scroll at 360 px, divider, danger item, light and dark, 40 px item height under `pointer: coarse` on phone and tablet; verify `npm run lint` and `npm run build` pass and by the screenshots in 3.2

## 3. E2E and integration

- [x] 3.1 Update `e2e/curation.e2e.ts`, `e2e/note-edit.e2e.ts`, `e2e/lesson-pdf.e2e.ts` (and `e2e/responsive.e2e.ts` if it touches these controls) to reach the actions through the menu; `qc-e2e` adds the menu scenarios (open, keyboard, action closes it, editing) with light and dark screenshots of the open menu on desktop and phone; rerun until `npm run e2e` passes
- [x] 3.2 `qc-ui` inspects the new screenshots; fix what it reports; verify its report has no open defect
- [ ] 3.3 Every check in `CLAUDE.md` passes and `openspec validate note-actions-menu --strict` passes; verifier report (`ai-sdlc-kit:verifier`) on the change

## Workflow follow-up

- Archive `note-actions-menu` after the verifier report.
