# Tasks

Contract: `design.md`. Backend first (one backend test run at a time), then frontend, then e2e.

## 1. Backend

- [x] 1.1 `app/auth/mail.py`: `try_send` beside `send_quietly` (design 2); `app/routes/auth.py`: `queue_mail` -> `send_mail`, `BackgroundTasks` removed from `signup`, `forgot`, `magic`, `verify_resend` (design 3); `app/routes/admin.py`: `invite_user` answers 502 with `INVITE_MAIL_FAILED` and the exception class when the send fails, invitation kept (design 4); `tests/auth_fakes.py`: `FailingMailer`; tests in `tests/test_admin_users.py` and `tests/test_auth_email.py` for every scenario of `specs/accounts/spec.md` and `specs/auth/spec.md` touched here (design 6); verify with `pytest`, `ruff check . && ruff format --check .`, `mypy app`

## 2. Frontend

- [x] 2.1 `src/components/UsersSettings.tsx`: show the 502 detail as the error, refetch the pending invitations after a failure (design 5); Vitest in `src/components/Users.test.tsx` for "Invitation email could not be sent"; verify with `npm test`, `npm run lint`, `npm run build`

## 3. E2E and verification

- [x] 3.1 qc-e2e: `e2e/outbox.ts` comment and `e2e/members.e2e.ts` assert the invite mail is in the outbox right after the answer (design 7); `npm run e2e` passes
- [x] 3.2 Every check in `CLAUDE.md` passes and `openspec validate mail-send-inline --strict` passes; verifier report in `verifier-report.md`
