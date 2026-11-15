# Tasks

## 1. Frontend

- [x] 1.1 Users table: one More actions menu per member row (`ActionMenu`, Enable/Disable, divider, Delete as danger), no menu on the admin's own row; verify with `Users.test.tsx` for "Row actions menu"
- [x] 1.2 Further reading only when the area has no learning field (`DomainSummary.field_id === null`); verify with the lesson page Vitest for both scenarios

## 2. E2E and verification

- [x] 2.1 qc-e2e: `members.e2e.ts` disables and deletes through the menu; a field-area lesson page has no Further reading; `npm run e2e` passes
- [x] 2.2 Every check in `CLAUDE.md` passes, `openspec validate users-menu-further-reading --strict` passes; verifier report
