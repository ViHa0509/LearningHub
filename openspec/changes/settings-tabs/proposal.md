## Why

Settings grew page by page (AI providers, Agents, Users, Sign-in, Data & sync, Account with only the time zone). A signed-in person still cannot edit their name, bio or avatar, change their email or password from the app, see and end their sessions, link a second sign-in method, set how the agent answers, or leave the app. Part of the backend exists (change password, sessions) with no screen. This change was first written for a single owner (2026-11); it is rewritten for the admin + members model (2026-11-23).

## What Changes

- Settings keeps its vertical tab list with an address per tab. The **Account** tab becomes **Profile** (`#/settings/profile`; `#/settings/account` keeps working and opens Profile). New tabs **Security** (`#/settings/security`) and **Preferences** (`#/settings/preferences`). AI providers, Agents, Users (admin), Sign-in (admin) and Data & sync stay as they are.
- **Profile** (every user):
  - display name and bio, with Save and Cancel
  - avatar: PNG, JPEG or WebP up to 1 MB, checked by its content, not its name; shown in the avatar menu; Remove goes back to initials
  - email change: a verification link goes to the new address, and the email changes only when that link is opened; the old address gets a notice; until then the old email stays in use
  - the time zone setting that is there today
  - **Delete account** (members only): after typing their email, the member's account, sessions and all their data are removed, the same as when the admin deletes a member. The admin cannot delete their own account (as today in Users).
- **Security** (every user): change password (set one when the account has none), linked sign-in methods (email and password, GitHub, Google) with Link and Unlink, never removing the last method, and active sessions with Revoke and Log out everywhere else.
- **Preferences** (every user): the agent's answer language (Auto, English, Vietnamese) added to the agent's instructions, and the default effort for new chats; saved to the account with Save. The theme stays the top bar switch.
- **Data & sync** gets **Delete all notes** (typed confirmation): the user's notes and their links are removed; lessons stay; files are released only when no other note uses them.
- Dropped from the first version: a separate export (the backup .zip in Data & sync already exports without keys), a theme preference on the account, and the select on narrow screens (the tab list already scrolls).

## Capabilities

### New Capabilities
- `settings`: the Profile, Security and Preferences tabs, account deletion by the member, and Delete all notes.

### Modified Capabilities
- none (the auth spec already sends email change to the settings capability; change password and sessions keep their auth requirements and get a screen here)

## Impact

- Backend: `PUT /api/auth/profile`, avatar upload, read and delete, email change request and confirm, `DELETE /api/auth/account`, link start for GitHub and Google from a signed-in session and unlink, `PUT /api/auth/preferences` (stored in the existing `users.preferences` JSONB), the language line in the agent's system prompt, `DELETE /api/notes` (all of the user's notes). No migration expected: `users` already has `display_name`, `bio`, `avatar_key` and `preferences`; email change tokens use the existing email token table if it has a purpose column (checked in task 1.1).
- Frontend: `ProfileSettings`, `SecuritySettings`, `PreferencesSettings` tab components, `SettingsNav`, `route.ts`, avatar in `AccountMenu`, Delete all notes in `DataSettings`, the chat's default effort from the account.
- Security: avatar files are untrusted (content checked, served with `X-Content-Type-Options: nosniff` and an image type, only to signed-in users); email change and link flows use single-use hashed tokens and state bound to the session; no password, token or link is logged.
