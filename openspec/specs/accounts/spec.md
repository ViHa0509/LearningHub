# accounts Specification

## Purpose
One admin and invited members share one Learning Hub: invitations, roles, disabling and deleting accounts, and keeping each user's notes, lessons, providers and settings their own.

## Requirements

### Requirement: Admin and members
The first account created on a server SHALL be the admin; every later account is a member. When no account exists, the app MUST offer to create the admin account (email and password, GitHub or Google). Existing data from before accounts were separated MUST belong to the admin. The admin MUST NOT be able to disable or delete their own account or change their own role.

#### Scenario: First visit
- **GIVEN** no account exists
- **WHEN** someone opens the app
- **THEN** the page offers to create the admin account

#### Scenario: Existing data kept
- **GIVEN** a server whose Owner had notes and lessons before this change
- **WHEN** the migration runs
- **THEN** the Owner is the admin and still sees all those notes and lessons

### Requirement: Invite only
After the admin exists, an account SHALL be created only from a valid invitation: a single-use link sent to the invited email, valid 7 days. The invited person MUST sign up with that email (password), or with GitHub or Google whose verified email equals it. Any other sign-up or GitHub or Google sign-in MUST be refused with "You need an invitation to join" and create no account and no session.

#### Scenario: Invited by email
- **GIVEN** the admin invited `ana@example.test`
- **WHEN** Ana opens the invitation link and sets a password
- **THEN** a member account for `ana@example.test` is created, signed in, and the invitation cannot be used again

#### Scenario: Invited, signs in with GitHub
- **GIVEN** an invitation for `ana@example.test`
- **WHEN** a GitHub account whose verified email is `ana@example.test` signs in
- **THEN** a member account is created and linked to that GitHub identity

#### Scenario: Not invited
- **WHEN** someone without an invitation signs up or signs in with GitHub or Google
- **THEN** it is refused with "You need an invitation to join" and no account is created

#### Scenario: Expired or revoked invitation
- **WHEN** an invitation link older than 7 days, revoked, or already used is opened
- **THEN** it is refused and no account is created

### Requirement: Users page
The admin SHALL have Settings -> Users listing users (email, name, role, created, last seen, disabled) and pending invitations, and SHALL be able to invite an email, revoke an invitation, disable or enable a member (disabling ends their sessions and blocks sign-in), and delete a member after typing their email (removing the member, their sessions and all their data). Members MUST get 403 from these routes and MUST NOT see the page.

#### Scenario: Disable a member
- **GIVEN** a member signed in on another browser
- **WHEN** the admin disables the member
- **THEN** the member's next request is answered 401 and signing in again is refused

#### Scenario: Delete a member
- **WHEN** the admin deletes a member after typing their email
- **THEN** the member's account, notes, lessons and providers are gone and other users' data is unchanged

#### Scenario: Members cannot manage users
- **WHEN** a member calls the users or invitations routes
- **THEN** the answer is 403

### Requirement: Personal data is separate per user
Notes and their files, links, lessons, AI providers and their keys, agent assignments and settings, sync keys, backups, restore and sync SHALL belong to one user. Every route and every agent tool, including the Claude Code tool server, MUST read and write only the signed-in user's rows; another user's item MUST answer 404 as if it did not exist. Duplicate detection of an import is per user. A stored file MUST be deleted only when no note of any user refers to it.

#### Scenario: Another user's note
- **GIVEN** user A has a note
- **WHEN** user B lists notes, opens A's note id, renames or deletes it
- **THEN** B's list does not include it and the other requests answer 404 without changing it

#### Scenario: Same file, two users
- **GIVEN** user A imported a file
- **WHEN** user B imports the same file and later A deletes their note
- **THEN** B's import is not a duplicate, and B's note still opens after A's delete

#### Scenario: Agent sees only its user's data
- **GIVEN** users A and B each have notes about caching
- **WHEN** B asks the agent about caching
- **THEN** the agent's tools find only B's notes

#### Scenario: Sync stays within one user
- **GIVEN** user B created a sync key on the target
- **WHEN** a backup is sent with B's key
- **THEN** only B's data on the target is replaced

### Requirement: Shared roadmaps and news
Roadmaps, roadmap references and the news SHALL be shared by all users: any signed-in user can read them and start a refresh or sync.

#### Scenario: Shared news
- **WHEN** a member refreshes the news
- **THEN** every user sees the new items

### Requirement: Admin-only features
GitHub and Google sign-in settings, the Users page and the Claude Code provider type SHALL be available to the admin only; for a member these routes MUST answer 403 and the UI MUST not offer them. Provider keys from `LH_*` environment variables MUST be imported for the admin only. The agent chat rate limit MUST count per user.

#### Scenario: Member and Claude Code
- **WHEN** a member creates or tests a provider of type Claude Code
- **THEN** it is refused with 403, and the type is not offered in the member's provider form

#### Scenario: Rate limit per user
- **GIVEN** user A used the whole chat limit for this minute
- **WHEN** user B sends a chat message
- **THEN** B's message is answered
