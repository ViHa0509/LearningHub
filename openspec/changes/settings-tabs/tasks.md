# Tasks

Contract: `design.md` and `specs/settings/spec.md`. Rewritten 2026-11-23 for admin + members, then for a separate Profile page and left-column navigation.

## 1. Backend

- [x] 1.1 (main session, security) Avatar upload, read and remove (design 2) and email change request and confirm (design 3), with the migration only if the token table needs it. Verify: pytest: PNG/JPEG/WebP accepted; 3 MB, PDF, SVG and HTML named `.png` refused; headers `nosniff` and an image type; another member's avatar 404; email link changes the email only on confirm, single use, 24 h, taken address refused at confirm, same answer at request.
- [x] 1.2 (main session, security) Link and unlink GitHub and Google from a signed-in session (design 4). Verify: pytest with the fake OAuth provider: link adds the identity; state of another session refused; identity of another account refused; last method cannot be unlinked; sign-in mode unchanged.
- [x] 1.3 Profile (`PUT /api/auth/profile`, length limits) and preferences (`PUT /api/auth/preferences`, `me_out` fields, the language line in the agent prompt) (design 5). Verify: pytest for limits, the stored values, and the system prompt line for `vi`, `en` and `auto`.
- [x] 1.4 Delete account for members and Delete all notes (design 1, 6), the admin delete moved onto the shared helper. Verify: pytest: member self-delete removes data and the session; admin refused; existing admin delete tests still pass; delete all notes keeps lessons and another user's note sharing the file.

## 2. Frontend

- [x] 2.1 Left-column navigation: `AppShell` shows `SettingsNav` on Settings pages and `ProfileNav` on Profile pages instead of `LearnedList` (same width, collapse and phone drawer); the tab row above Settings content is removed; `#/profile`, `#/profile/security`, `#/profile/preferences` in `route.ts`, `#/settings/account` opens Profile; "Profile" in `AccountMenu`. Verify: Vitest for the routes, the nav per role, and the Learned list coming back on other pages.
- [x] 2.2 Profile General: name, bio, time zone (moved from Account), email with its state, Verify email, Change email, avatar upload and remove, avatar in the avatar menu, Delete account for members. Save and Cancel on every form, discard prompt. Verify: Vitest for each scenario of Profile details, Avatar, Email change, Delete account.
- [x] 2.3 Profile Security (password, linked methods, sessions) and Preferences; the composer's starting effort from the account; Delete all notes in Data & sync. Verify: Vitest for each scenario; `npm run lint`, `npm run build`.

## 3. E2E and verification

- [x] 3.1 qc-e2e: e2e files for the left-column navigation and each Profile section from the spec scenarios; existing Settings e2e updated for the moved tabs (tests changed only where the spec changed the UI) (emails read from the outbox, OAuth through the fake provider); screenshots light, dark and phone. Verify: `npm run e2e` passes.
- [x] 3.2 qc-ui inspects the new screenshots. Verify: no open defect, or each is listed in `evidence.md`.
- [x] 3.3 Every check in `CLAUDE.md` passes and `openspec validate settings-tabs --strict` passes. Verify: verifier report in `verifier-report.md`.

## Workflow follow-up

- Commit and push to `main` when everything is okay, then archive the change.
