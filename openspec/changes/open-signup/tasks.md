# Tasks

## 1. Backend

- [x] 1.1 `routes/auth.py`: `signup` creates a member after the admin exists (409 "An account with this email already exists" for a used email; rate limit and password rules as today; session and verification mail); `user_for` creates a verified member for a provider email without an account and refuses an unverified account's email with the code `email_unverified`; verify with the changed and new cases in `test_accounts.py`, `test_auth_email.py` and `test_auth_oauth.py` for every scenario of "Open sign-up and invitations", and backend lint, format check, `mypy app`, pytest

## 2. Frontend

- [x] 2.1 `AuthPages.tsx`: Sign up page (`#/auth/signup`) with display name, email, password, confirmation and the provider buttons, linked from the login page and back; messages for 409 and `email_unverified`; verify with Vitest for the Sign up page scenario and the messages, `npm run lint`, `npm run build`

## 3. E2E and integration

- [x] 3.1 Update `e2e/auth.e2e.ts` and `e2e/members.e2e.ts` (what was refused now creates a member, which the test removes again); new e2e: sign up on the page, land signed in as a member with none of the admin's data, used email refused; screenshots light and dark; rerun until `npm run e2e` passes
- [ ] 3.2 Every check in `CLAUDE.md` passes and `openspec validate open-signup --strict` passes; verifier report (`ai-sdlc-kit:verifier`) on the change

## Notes from the implementation (2026-11-13)

- The takeover refusal uses the new code `account_unverified` (`email_unverified` already means "the provider did not verify the email").
- `e2e/global-setup.ts` now empties `users` of the e2e database before the downgrade: an account left by an earlier run made the downgrade refuse ("more than one user").
- `e2e/auth.e2e.ts` no longer creates a password member (its verification mail would change the outbox the verify-page test reads); `e2e/signup.e2e.ts` covers that.
- Unverified members can use the app at once, as the unverified admin could; the account menu asks them to verify.
