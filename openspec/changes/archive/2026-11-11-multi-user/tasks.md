## 1. Backend

- [x] 1.1 Migration 0012 and models (roles, placeholder, disabled_at, invitations, user_id on data tables, per-user keys); `app/auth/current.py` (`current_user`, `require_admin`); signup and OAuth rules (admin first, invitation, takeover of the placeholder, disabled users); tests for the migration (existing data goes to the admin) and the auth rules
- [x] 1.2 Invitations and Users routes (`/api/admin/*`, `/api/auth/invitation*`), mail with the invite link; tests (invite, accept, expired, revoked, reused, OAuth with invitation, not invited, disable, delete, 403 for members)
- [x] 1.3 Scope notes, lessons, links and domain views by user; per-user duplicate detection; `release_blob` across users; isolation tests (another user's ids answer 404, lists exclude them, shared file survives the other user's delete)
- [x] 1.4 Scope providers, agents, resolve, env_import (admin), AgentTools and the claude-code MCP server (`LH_AGENT_USER_ID`), Claude Code admin-only, rate limit per user; tests (agent sees only its user's notes, member gets 403 for claude-code, limit per user)
- [x] 1.5 Data sync per user (backup and restore scoped, new ids on restore, sync key owned by a user); tests

## 2. Frontend

- [x] 2.1 Users page (admin), Settings nav by role, invitation page, role in the account menu, "Create the admin account", provider types from the API; Vitest for each scenario the UI shows

## 3. Docs and E2E

- [x] 3.1 README (inviting users, roles, what is shared) and CLAUDE.md conventions (every data query by user; admin-only features)
- [x] 3.2 qc-e2e: admin invites a member through the outbox, member accepts, isolation through the UI, disable and delete, member cannot see Users, Sign-in or the Claude Code type; full suite passes
