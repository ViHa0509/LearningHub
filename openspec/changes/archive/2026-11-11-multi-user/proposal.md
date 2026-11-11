## Why

Learning Hub allows exactly one account, the Owner. The owner now wants other people to use the Deploy copy (`https://learninghub.vihc0509.workers.dev`), each with their own learning data. Decisions made on 2026-11-10:

- **Joining:** invite only.
- **AI providers:** each user brings their own.
- **Personal data:** everything personal is separate per user.
- **Shared:** roadmaps and news stay shared.

## What Changes

- **Admin and members.** The first account is the **admin**. The existing Owner becomes the admin and keeps all existing data. Every later account is a **member**.
- **Invite only:**
  - In **Settings -> Users**, the admin invites an email address. An invitation email (or the outbox) carries a single-use link, valid 7 days.
  - The invited person creates an account with that email and a password, or with GitHub or Google whose verified email equals the invited email.
  - Sign-up, GitHub and Google refuse anyone else. The message is "You need an invitation to join".
- **Users page (admin):**
  - lists users (email, name, role, created, last seen, disabled) and pending invitations;
  - lets the admin invite, revoke an invitation, disable or enable a member (disabling ends their sessions) and delete a member (removes the member's data after typing the email);
  - the admin cannot disable or delete themself.
- **Data per user.** These belong to one user, and every route and agent tool reads and writes only the signed-in user's rows:
  - notes, their files and links;
  - lessons;
  - AI providers and their keys;
  - agent assignments and settings;
  - sync keys, backups, restore and sync.
  - Duplicate detection of an imported file is per user. Note files stay content-addressed and are shared on disk; a file is deleted only when no note of any user refers to it.
- **Shared for everyone:** roadmaps, roadmap.sh references and the news. Any signed-in user can read them and start their refresh.
- **Admin only:**
  - GitHub and Google sign-in settings;
  - the Users page;
  - the **Claude Code** provider type, which runs the CLI on the server with the admin's login. Members get 403, and the type is not offered to them.
  - Provider keys from `LH_*` environment variables are imported for the admin only.
- **Limits per user.** The agent chat limit counts per user instead of for the whole server.
- **Account menu** shows the role. The first-visit page says "Create the admin account".

## Capabilities

### New Capabilities
- `accounts`: admin and members, invitations, the Users page, per-user data isolation, admin-only features.

### Modified Capabilities
- `auth`: "One Owner account" is replaced by the accounts capability.

## Impact

- **Migration 0012:**
  - `users.role` values become `admin` and `member`, and the single-owner index is dropped;
  - adds `users.disabled_at` and a new table `invitations`;
  - adds `user_id` (FK users, cascade) to notes, lessons, ai_providers, agent_providers, agent_settings and sync_keys, filled with the existing admin; rows from a database with no user yet are claimed by the first account;
  - unique keys become per user: notes `(user_id, content_sha256)`, lessons `(user_id, node_id)`, ai_providers `(user_id, name)`, agent_providers `(user_id, agent_id, role)`, agent_settings `(user_id, agent_id)`.
- **Backend:**
  - every data route takes the signed-in user;
  - `AgentTools`, `resolve`, `mcp_server` (user id passed by the parent through the environment), backup, restore and upload (owned by the key's user) are scoped to that user;
  - new routes `/api/admin/users`, `/api/admin/invitations` and `/api/auth/invitation`.
- **Frontend:** Users page, invitation accept page, role in the account menu, "Create the admin account", the Claude Code type hidden for members.
- **Security:**
  - isolation tests cover every data route (user B never sees or changes user A's data, by id or by list);
  - the admin-only routes answer 403 to members.
