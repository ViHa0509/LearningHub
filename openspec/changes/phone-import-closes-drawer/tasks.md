# Tasks

Contract: `design.md`. Frontend only.

## 1. Frontend

- [x] 1.1 `AppShell.tsx`: `onImport` opens the import dialog and, on a phone, closes the learned-list drawer (design 1-4); verify with Vitest in `AppShell.test.tsx` for "Import from the drawer on a phone", "Import from an empty list on a phone", "Cancel the import on a phone" and "Import on a desktop", `npm run lint`, `npm run build`

## 2. E2E and verification

- [x] 2.1 qc-e2e: in `e2e/responsive.e2e.ts` (phone), Import in the Learned drawer hides the drawer and shows the import dialog; Cancel leaves the drawer closed; screenshot `phone-import-dialog` light and dark; `npm run e2e` passes
- [x] 2.2 Every check in `CLAUDE.md` passes and `openspec validate phone-import-closes-drawer --strict` passes; verifier report
