# Verifier report: mail-send-inline

Verdict: **pass** (2026-11-19, `ai-sdlc-kit:verifier`; the verifier is read-only, so the main session saved this file)

## Checks

| Command | Exit | Result |
|---|---|---|
| `cd backend && .venv/Scripts/python -m pytest` | 0 | pass |
| `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .` | 0 | pass ("All checks passed!", "182 files already formatted") |
| `cd backend && .venv/Scripts/mypy app` | 0 | pass ("Success: no issues found in 89 source files") |
| `cd frontend && npm test` | 0 | pass (39 files, 539 tests) |
| `cd frontend && npm run lint` | 0 | pass |
| `cd frontend && npm run build` | 0 | pass (chunk-size warning only) |
| `cd frontend && npm run e2e` | not rerun by the verifier | qc-e2e ran the full suite after the last change: 303 passed, 1 failed, 32 skipped. The one failure, `[phone] responsive.e2e.ts:190` "No sideways page scroll: news page", is a `waitForLoadState('networkidle')` timeout, unrelated to mail. It passed when rerun alone (25/25). The push gate reruns the full e2e. |
| `openspec validate mail-send-inline --strict` | 0 | pass |

## Task evidence

| Task | Evidence |
|---|---|
| 1.1 backend | `try_send` in `backend/app/auth/mail.py`. `queue_mail` became `send_mail` in `routes/auth.py`. `BackgroundTasks` is removed from `signup`, `forgot`, `magic`, `verify_resend` and `admin.invite`, and no `queue_mail` or `BackgroundTasks` is left in `app/`. `invite` answers 502 with `INVITE_MAIL_FAILED (<class>)` and keeps the invitation. `FailingMailer` is at `tests/auth_fakes.py:36`. |
| 2.1 frontend | `UsersSettings.tsx` shows the 502 message and refetches pending invitations. Vitest test at `Users.test.tsx:202`. |
| 3.1 e2e | `members.e2e.ts:170` asserts the invite mail is in the outbox right after the answer. The comment in `outbox.ts` is updated. |
| 3.2 | All checks above pass and validate passes. |

## Scenario to test map

| Scenario | Test |
|---|---|
| Accounts: Mail sent before the answer | `backend/tests/test_admin_users.py:447` |
| Accounts: Mail server refuses the invitation email | `backend/tests/test_admin_users.py:454` |
| Accounts: Invitation email could not be sent (Users page) | `frontend/src/components/Users.test.tsx:202` |
| Auth: Mail written before the answer | `backend/tests/test_auth_email.py:305` |
| Auth: Mail server refuses the message | `backend/tests/test_auth_email.py:312`, `:337` |
| Accounts: unchanged scenarios (invited by email, not invited, expired or revoked, Users page) | existing tests in `test_admin_users.py` (e.g. `:66`, `:179`, `:190`, `:233`, `:288`, `:348`) |

Uncovered scenarios: none.

## Notes

- **Send-failure log line:** the only one is `could not send the %s email (%s)`, with the purpose and the exception class. There is no `exc_info`, so no SMTP message (which can hold a recipient address) and no traceback is logged.
- **The 502 detail** is a fixed string plus the class name, and has no `invite_url`. The tests assert that no address, `#/auth/invite` or `token=` appears in the logs.
- **Magic-link log test** checks only the address and `token=`, not `#/auth/`.
