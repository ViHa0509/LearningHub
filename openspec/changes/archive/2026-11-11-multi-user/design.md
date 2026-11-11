## Context

Single-owner assumptions, from the 2026-11-10 scan:
- **Users:** the `uq_users_single_owner` index, `role='owner'`, signup closing once any user exists (`routes/auth.py:210`), and `owner_for` in the OAuth callback (`auth.py:463-479`).
- **Data tables have no `user_id`.**
- **Agent tools:** `AgentTools(session, catalog)` has no user. `mcp_server.py` opens its own DB engine.
- **Note files:** deleting a note deletes its blob unconditionally (`notes.py:272-279`).
- **Rate limit:** the agent `RateLimiter` is one global window.

## Decisions

### Roles, the placeholder admin and the current user
- `users.role` is `admin` or `member` (CHECK). A partial unique index allows one `admin`.
- `users.disabled_at` (nullable).
- `users.placeholder boolean default false`: a no-login admin row created by the migration only when data rows exist but no user does (auth was off).
  - `/api/auth/status.has_owner` is false while only a placeholder exists.
  - The first admin sign-up (password or OAuth) **takes over** the placeholder row: it sets the email and credentials and clears the flag, so the data stays with the admin.
- `app/auth/current.py`:
  - `current_user(request, db) -> User`:
    - with the login on: the session's user, and 401 if disabled;
    - with `LH_AUTH_REQUIRED=false`: the admin, creating a placeholder admin when none exists.
  - `require_admin` gives 403 for members.
- Every data route takes `user: User = Depends(current_user)` and filters by `user.id`. Another user's id answers **404**.
- `require_signed` rejects a disabled user's session (401), and login rejects them with "This account is disabled".

### Migration 0012
- **Users:**
  - `owner` becomes `admin`; drop `uq_users_single_owner` and create `uq_users_single_admin`;
  - add `disabled_at` and `placeholder`.
- **New table `invitations`:** `id uuid`, `email text` (lower-cased), `token_hash text unique`, `invited_by uuid FK users ON DELETE SET NULL`, `created_at`, `expires_at`, `accepted_at null`, `revoked_at null`.
- **`user_id uuid`** on notes, lessons, ai_providers, agent_providers, agent_settings and sync_keys:
  - added nullable, then filled with the admin's id;
  - if rows exist and no user does, a placeholder admin is inserted first (email `admin@localhost.invalid`);
  - then `NOT NULL` and `FK users ON DELETE CASCADE`.
- **New unique keys:**
  - notes `(user_id, content_sha256)`, replacing the global unique;
  - lessons PK `(user_id, node_id)`;
  - ai_providers `(user_id, name)`;
  - agent_providers PK `(user_id, agent_id, role)`;
  - agent_settings PK `(user_id, agent_id)`.
- **Downgrade:** allowed only when at most one user exists. It drops the columns and restores the old keys.

### Auth and invitations
- **Signup** (`POST /api/auth/signup`): allowed only when no real (non-placeholder) user exists, and creates the admin. Otherwise it answers 403 "You need an invitation to join".
- **Invitations (admin):**
  - `POST /api/admin/invitations {email}` creates or replaces the pending invitation for that email: a 32-byte urlsafe token, stored hashed, valid 7 days. It mails `{public_url}/#/auth/invite?token=...` (the outbox without SMTP).
  - It answers 409 if the email already has an account.
  - `GET /api/admin/invitations` lists the pending ones; `DELETE /api/admin/invitations/{id}` revokes one.
- **Accepting (public routes):**
  - `GET /api/auth/invitation?token=` answers `{email, expires_at}`, or 404 when invalid, expired, revoked or used.
  - `POST /api/auth/invitation/accept {token, password, display_name?}`:
    - creates a member with a verified email;
    - marks the invitation accepted and starts a session;
    - is rate-limited like signup.
- **OAuth callback:** after the identity is known, in this order:
  1. a linked identity signs in that user;
  2. otherwise the user with that verified email (links it);
  3. otherwise a valid pending invitation for that verified email creates a member (links it and accepts the invitation);
  4. otherwise, when no real user exists, it creates the admin (takes over the placeholder);
  5. otherwise refuse with error `not_invited`, shown as "You need an invitation to join".
- **Disabled users:** cannot sign in by any method.

### Users page (admin)
- `GET /api/admin/users` answers `[{id, email, display_name, role, created_at, last_seen_at, disabled}]`.
  - `last_seen_at` is the newest session's `last_seen_at`.
- `PUT /api/admin/users/{id}/disabled {disabled}` deletes that user's sessions when disabling. Refused for the admin themself (422).
- `DELETE /api/admin/users/{id}` with body `{confirm_email}`:
  - deletes the user, cascading to their data;
  - then deletes the blobs no longer referenced by any note.
  - Refused for the admin (422).

### Scoping the rest
- **Notes:**
  - every query adds `Note.user_id == user.id`;
  - duplicate detection uses `(user_id, sha)`;
  - `delete` and `replace_content` remove a blob only when `count(notes where storage_key = key) == 0` across all users (helper `release_blob`).
- **Lessons, links and domains views:** scoped by user.
- **Providers and agents:**
  - `ai_providers`, `agent_providers` and `agent_settings` are scoped by user;
  - assigning a provider to an agent checks that it belongs to the user (404 otherwise);
  - `resolve` works on the user's rows.
- **`env_import`** imports into the admin only. With no admin yet, it skips.
- **Claude Code type:**
  - `/api/ai-providers/types` omits `claude-code` for members;
  - create, update, test and list-models of that type answer 403 for members;
  - resolution refuses to use a `claude-code` provider owned by a member (it cannot exist, but defence in depth).
- **Agent tools:**
  - `AgentTools(session, catalog, user_id=...)` filters every query and write by `user_id`;
  - for the claude-code CLI, `claude_code.py` passes `LH_AGENT_USER_ID` in the MCP server's environment, and `mcp_server.database_tools()` reads it and refuses to start without it.
- **Rate limit:** `RateLimiter` keyed by `str(user.id)` (one window per user).
- **Data sync:**
  - backup and restore are scoped to the user;
  - restore deletes only that user's rows;
  - restore gives notes and providers **new ids** (remapping `agent_providers.provider_id`), so restoring into another user or server never collides with someone else's ids;
  - sync keys belong to a user; an upload restores into the key's user.
- **Shared:** news and node_resources stay global. Any signed-in user may refresh or sync them.

### Frontend
- **Settings nav:** Users appears for the admin only (`#/settings/users`).
- **`UsersSettings.tsx`:**
  - Invite (an email field with Save-style Send and Cancel);
  - the pending invitations with Revoke (confirm);
  - the users table with Disable or Enable (confirm) and Delete (type the email);
  - the user's own row is marked "You" and has no actions.
- **Invitation page `#/auth/invite?token=`:**
  - shows "Join Learning Hub as <email>", with the password, confirm password and display name fields;
  - offers GitHub and Google when configured, with the note "sign in with an account whose verified email is <email>";
  - shows errors for a used or expired link.
- **Account menu:** shows "Admin" or "Member" under the email.
- **First-visit page:** title "Create the admin account".
- **Provider form:** offers only the types the API returns (claude-code is absent for members).
- **Sign-in and Users nav items:** admin only. Data & sync stays for everyone.

## Risks

- **A missed filter leaks data across users.** Mitigation: an isolation test that walks every data route as user B against user A's ids and lists (backend), plus e2e with a member.
- **The migration is irreversible once members exist.** Downgrade refuses then; the README says to take a backup first.
- **Cascade deletes remove a member's data permanently.** Typing the email confirms it.
