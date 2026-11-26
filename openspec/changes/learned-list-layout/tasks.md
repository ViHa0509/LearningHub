# Tasks

Contract: `design.md` and `specs/learning-views/spec.md`.

## 1. Frontend

- [x] 1.1 One list of groups (design 1) and the menus (design 2): `lib/grouping.ts`, `LearnedList.tsx`, `index.css`; update the Vitest tests that used `domains`/`unsorted`, the UNSORTED heading, the Group with AI button or the Rename buttons. Verify: Vitest per scenario of "Learned-items list" (Grouped list), "Unsorted is grouped by category", "Group unsorted notes with AI" (menu item, busy, Nothing without a topic), "Rename a category group"; `npm run lint`, `npm run build`.
- [x] 1.2 Resizable panes (design 3): `AppShell.tsx` (or a small hook next to it), `index.css`. Verify: Vitest for clamping, keyboard, reset, saved widths and a broken saved value; lint, build.

## 2. E2E and verification

- [x] 2.1 qc-e2e: update the e2e files that use the UNSORTED section, the Group with AI button or the Rename group buttons (`unsorted-categories.e2e.ts`, `curation.e2e.ts`, `agent-learned-notes.e2e.ts`, drag-drop files) to the new spec; new tests for merged groups and their order, the menus, resize by drag and keys, reset, reload keeps widths, no handles on phone; screenshots light, dark and phone. Verify: the touched files and `responsive.e2e.ts` pass in one run.
- [x] 2.2 qc-ui inspects the new screenshots. Verify: no open defect, or each listed in `evidence.md`.
- [x] 2.3 Every check in `CLAUDE.md` passes and `openspec validate learned-list-layout --strict` passes. Verify: verifier report in `verifier-report.md`.
