## Why

Learning Hub stores the user's notes, lessons and encrypted provider keys, but anyone who can reach the local server can use it. The owner wants a real login: email and password, GitHub, Google, and a magic link by email. The app stays local with a single Owner account.

## What Changes

- **Accounts:** one Owner.
  - The first account created becomes the Owner and sign-up closes after that.
  - GitHub or Google can create the Owner while no Owner exists. Afterwards they only sign in an identity already linked to the Owner, or one whose verified email equals the Owner's verified email (which links it).
- **Sign-in methods:**
  - Email and password: sign up, log in, log out, forgot or reset password, and change password in Settings.
  - GitHub and Google OAuth: authorization code flow with `state` and PKCE, server side.
  - Magic link: a single-use link by email, valid 15 minutes.
  - Email verification after sign-up and after an email change.
- **Sessions:**
  - A random token in an HttpOnly, SameSite=Lax cookie `lh_session` (Secure when served over https). Only its SHA-256 hash is stored in the database.
  - Sessions slide to 30 days. Sessions can be listed, one revoked, or all others logged out.
- **Every API route requires a session**, except `/api/health`, the `/api/auth/*` routes, and the OAuth callbacks.
  - The `X-LearningHub: 1` header rule for mutating calls stays (CSRF defense together with SameSite).
  - Note pages keep their sandbox. The note original and print URLs also require the session cookie, which the sandboxed frame sends because the request goes to the app's own origin with the cookie set for it.
- **Email:**
  - Sent over SMTP when `LH_SMTP_*` is configured.
  - Otherwise each message is written to `storage/outbox/<time>-<purpose>.eml` and the server log prints that path. This is local-only use, and the UI says so.
- **OAuth configuration:**
  - `LH_GITHUB_CLIENT_ID/SECRET` and `LH_GOOGLE_CLIENT_ID/SECRET`, plus `LH_PUBLIC_URL` (default `http://localhost:5173`) for redirect URIs.
  - Unconfigured providers show as unavailable on the login page, with the reason.
- **Protection:**
  - Passwords are hashed with scrypt from the standard library (N=2^15, r=8, p=1, 16-byte salt) and must be at least 10 characters.
  - Auth endpoints are rate-limited: 10 attempts per minute per IP and email.
  - The same message is returned for a wrong email and a wrong password.
  - Tokens are compared in constant time.
- **UI:**
  - Login, sign-up ("Create the owner account" while none exists), forgot and reset password, magic link and verify-email pages, in the app's dark and light theme.
  - The top bar shows an avatar menu (display name, Settings, Log out) instead of the bare Settings link.
- **Tests:** never call GitHub, Google or a real mail server. OAuth runs against a fake provider server, and email is captured by an injectable mailer or the outbox.

## Capabilities

### New Capabilities
- `auth`: accounts, sign-in methods, sessions, email, protection of the API.

### Modified Capabilities

## Impact

- **Backend:**
  - `app/auth/` (passwords, sessions, tokens, OAuth, mail)
  - `app/routes/auth.py`, a session dependency on every router, migration `0010_auth` (users, oauth_accounts, sessions, auth_tokens), settings
  - tests, plus fake OAuth and mail
- **Frontend:**
  - auth pages, a session query (`GET /api/auth/me`) gating the app, the avatar menu, `api.ts` (credentials, 401 handling)
  - tests
- **E2E:** a global setup creates the Owner and saves the session (storage state) so existing tests keep working; new auth tests.
- **CLAUDE.md:** the project description changes from "Single local user" to "single Owner account behind a login".
