# Proposal

## Why

On the hosted copy (Vercel serverless Python, https://learning-hub-petrus.vercel.app) the backend hands every email to a FastAPI background task that runs after the answer has left. Vercel freezes the function as soon as the answer is sent, so the SMTP session dies: the server logs `could not send the invitation email (SMTPServerDisconnected)` while the Users page says "Invitation sent to …" and nobody receives anything (2026-11-16, invitation to a Gmail address with SMTP set up through `LH_SMTP_*`). The same path carries verification, password reset and magic-link mail, so none of them can be relied on there either.

## What Changes

- Every outgoing email (invitation, sign-up verification, verify/resend, password reset, magic link) is sent inside the request, before the answer, instead of in a background task. The 15 s SMTP timeout stays; outbox mode is unchanged.
- `POST /api/admin/invitations`: when the email cannot be sent, the invitation is still created (it is listed under Pending invitations and can be revoked), but the route answers 502 with the detail "The invitation was created but the email could not be sent (SMTPServerDisconnected)" (the exception class name, nothing else). The Users page shows that text as an error instead of "Invitation sent".
- The public auth routes (`/signup`, `/forgot`, `/magic`, `/verify/resend`) keep their current generic answers when the email cannot be sent, so nothing about the account can be learned from the answer; the failure is logged by purpose and exception class only, as today.
- No address, link, token or password in any log or error detail (unchanged rule).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `accounts`: the "Invite only" and "Users page" requirements gain the behavior that the invitation email is sent before the answer, and that a failed send is reported to the admin while the invitation is kept.
- `auth`: the "Magic link and email verification" requirement states that mail is sent before the answer and that a failed send does not change the public answer.

## Impact

- Backend: `app/routes/auth.py` (`queue_mail` and its five callers lose the `BackgroundTasks` dependency), `app/routes/admin.py` (invitation route reports the failure), `app/auth/mail.py` (a send that reports failure to the caller beside the quiet one).
- Backend tests: a mailer fake that raises `smtplib.SMTPServerDisconnected`; tests for the invitation 502, for the generic auth answers and for the log line without address or link.
- Frontend: `src/components/UsersSettings.tsx` shows the 502 detail; a Vitest test in `src/components/Users.test.tsx`.
- E2E: `e2e/members.e2e.ts` and `e2e/outbox.ts` no longer need to wait for the outbox file after the answer; the comment in `outbox.ts` about the background task goes.
- No migration, no new dependency, no API shape change except the new 502 on the invitation route.
