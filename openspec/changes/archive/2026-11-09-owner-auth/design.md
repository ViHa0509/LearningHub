## Data

- **`users`:** id uuid; email text unique (stored lower-case); email_verified_at; display_name; bio; avatar_key (storage key, nullable); password_hash (nullable: OAuth-only accounts); role ('owner'); preferences jsonb; created_at.
- **`oauth_accounts`:** id; user_id fk; provider ('github' | 'google'); provider_user_id; email; created_at; unique (provider, provider_user_id).
- **`sessions`:** id; user_id fk; token_hash (sha256 hex, unique); created_at; last_seen_at; expires_at; user_agent (first 200 chars); ip.
- **`auth_tokens`:** id; purpose ('verify_email' | 'reset_password' | 'magic_link'); token_hash unique; user_id fk nullable; email; expires_at; used_at; created_at.

## Decisions

- **Sessions, not JWT.** The browser and the API share one origin through the Vite proxy (BFF), so an opaque server-side session in an HttpOnly cookie is simpler and revocable. A JWT would add refresh logic with no gain here.
- **scrypt from hashlib.** No new dependency. Parameters are stored in the hash string (`scrypt$N$r$p$salt$hash`) so they can be raised later.
- **One Owner:**
  - `POST /api/auth/signup` works only while there are no users.
  - An OAuth callback with no users creates the Owner with the provider's verified email. With an Owner, it links when the provider identity is already linked, or when the provider's verified email equals the Owner's verified email. Otherwise it is refused with "This app has an owner already".
- **OAuth:**
  - The state and the PKCE verifier live in a short-lived HttpOnly cookie (10 min).
  - GitHub: authorize, then the token endpoint, then `/user` and `/user/emails`, using the verified primary email.
  - Google: the OIDC authorize endpoint (scope `openid email profile`), then the token endpoint, then the userinfo endpoint. `email_verified` must be true.
  - The provider base URLs are settings, so tests point them at a fake server.
- **Email:** a `Mailer` protocol with `SmtpMailer` (STARTTLS on port 587, or SSL on port 465) and `OutboxMailer` (writes .eml files). Links point to `LH_PUBLIC_URL/#/auth/...`; the page posts the token to the API.
- **Gate:**
  - A FastAPI dependency on every router except auth and health returns 401 without a valid session.
  - The frontend reads `GET /api/auth/me` and shows the auth pages on 401. The current hash route is kept, so the user lands back on it after login.
- **Rate limit:** in-memory windows keyed by IP and by email, on login, signup, magic link and reset requests.
- **Logout everywhere:** deletes every session of the user except the current one.

## Risks

- Moving every route behind a session touches every test. Tests get an authenticated client fixture by default, and a separate unauthenticated fixture checks the 401s.
- The outbox mailer holds live sign-in links on disk. That is acceptable for local single-user use. The UI says so, and the outbox files are git-ignored under `storage/`.
