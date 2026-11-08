## 1. Backend

- [x] 1.1 Migration `0010_auth` (users, oauth_accounts, sessions, auth_tokens) and models
- [x] 1.2 `app/auth/passwords.py` (scrypt hash and verify, parameters in the hash) and `app/auth/sessions.py` (create, hash, slide, revoke, cookie); session dependency on every router except health and auth; 401 tests
- [x] 1.3 Email and password routes: signup (Owner only), login, logout, me, change password, forgot and reset; rate limit; tests
- [x] 1.4 Mail: `Mailer` protocol, `SmtpMailer`, `OutboxMailer`; magic link and verify-email routes; tests with a capturing mailer
- [x] 1.5 OAuth GitHub and Google (state, PKCE, verified email, Owner linking rules) with configurable endpoints; tests against a fake provider server
- [x] 1.6 Sessions list, revoke, log out everywhere else; tests
- [x] 1.7 Existing tests use an authenticated client by default; unauthenticated checks for every router

## 2. Frontend

- [ ] 2.1 Session gate (`GET /api/auth/me`), 401 handling in `api.ts`, return to the same route after login
- [ ] 2.2 Pages: login, create owner, forgot and reset password, magic link sent and open, verify email; provider buttons with the not-configured state; tokens taken from the URL and posted to the API
- [ ] 2.3 Avatar menu in the top bar (avatar or initials, display name, Settings, Log out)
- [ ] 2.4 Vitest for every scenario

## 3. E2E and docs

- [ ] 3.1 Playwright global setup creates the Owner and saves the session; existing tests keep passing
- [ ] 3.2 qc-e2e: create owner, log out and in, wrong password, magic link through the outbox, GitHub through a fake provider, sessions; loop until the suite passes
- [ ] 3.3 CLAUDE.md and README: single Owner behind a login, `.env` settings for OAuth and SMTP
