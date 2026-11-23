# Tasks

Contract: `design.md` and `specs/settings/spec.md`. Rewritten 2026-11-23 for admin + members.

## 1. Backend

- [ ] 1.1 (main session, security) Avatar upload, read and remove (design 2) and email change request and confirm (design 3), with the migration only if the token table needs it. Verify: pytest: PNG/JPEG/WebP accepted; 3 MB, PDF, SVG and HTML named `.png` refused; headers `nosniff` and an image type; another member's avatar 404; email link changes the email only on confirm, single use, 24 h, taken address refused at confirm, same answer at request.
- [ ] 1.2 (main session, security) Link and unlink GitHub and Google from a signed-in session (design 4). Verify: pytest with the fake OAuth provider: link adds the identity; state of another session refused; identity of another account refused; last method cannot be unlinked; sign-in mode unchanged.
- [ ] 1.3 Profile (`PUT /api/auth/profile`, length limits) and preferences (`PUT /api/auth/preferences`, `me_out` fields, the language line in the agent prompt) (design 5). Verify: pytest for limits, the stored values, and the system prompt line for `vi`, `en` and `auto`.
- [ ] 1.4 Delete account for members and Delete all notes (design 1, 6), the admin delete moved onto the shared helper. Verify: pytest: member self-delete removes data and the session; admin refused; existing admin delete tests still pass; delete all notes keeps lessons and another user's note sharing the file.

## 2. Frontend

- [ ] 2.1 Tabs Profile (replacing Account, `#/settings/account` opens it), Security and Preferences in `SettingsNav` and `route.ts`. Verify: Vitest for the routes and nav.
- [ ] 2.2 Profile tab: name, bio, avatar upload and remove, email change, time zone (moved from Account), Delete account for members; avatar in the avatar menu. Save and Cancel on every form, discard prompt. Verify: Vitest for each spec scenario of Profile, Avatar, Email change, Delete account.
- [ ] 2.3 Security tab (password, linked methods, sessions) and Preferences tab; the composer's starting effort from the account; Delete all notes in Data & sync. Verify: Vitest for each scenario; `npm run lint`, `npm run build`.

## 3. E2E and verification

- [ ] 3.1 qc-e2e: one e2e file per tab from the spec scenarios (emails read from the outbox, OAuth through the fake provider); screenshots light, dark and phone. Verify: `npm run e2e` passes.
- [ ] 3.2 qc-ui inspects the new screenshots. Verify: no open defect, or each is listed in `evidence.md`.
- [ ] 3.3 Every check in `CLAUDE.md` passes and `openspec validate settings-tabs --strict` passes. Verify: verifier report in `verifier-report.md`.

## Workflow follow-up

- Commit and push to `main` when everything is okay, then archive the change.
