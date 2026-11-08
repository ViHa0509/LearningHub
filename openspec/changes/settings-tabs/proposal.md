## Why

Settings is one long page with providers and agents. With login, profile, security and preferences arrive, so Settings needs clear sections, as in Cursor, Linear or Notion.

## What Changes

- Settings becomes a page with vertical tabs on the left, each with its own address:
  - **Profile** (`#/settings/profile`):
    - avatar upload (PNG, JPEG or WebP, up to 1 MB; otherwise initials), display name, bio
    - email, with a "verify" state; changing the email sends a verification link
    - change password
    - delete account: typed confirmation; removes the account and its sessions, and the app returns to "create the owner account"; notes and lessons stay
  - **Security** (`#/settings/security`): linked sign-in methods (email, GitHub, Google) with Link and Unlink (the last method cannot be unlinked), and active sessions with Revoke and "Log out everywhere else".
  - **AI Providers** (`#/settings/providers`): the current providers list and agents, unchanged. `#/settings` and the existing provider routes keep working.
  - **Preferences** (`#/settings/preferences`): theme (System, Light or Dark, the same switch as the top bar), the agent's answer language (Auto, English or Vietnamese, added to the system prompt), and the default effort (Low, Medium or High) for new chats. Saved to the account with Save.
  - **Data & Privacy** (`#/settings/data`):
    - Export data: a .zip with notes (original pages and metadata), lessons, roadmap links, and provider configurations without keys.
    - Delete all notes: typed confirmation.
- Every edit form follows the Save rule (explicit Save and Cancel).
- The tabs collapse into a top select on narrow screens.

## Capabilities

### New Capabilities
- `settings`: the tabbed Settings page with profile, security, preferences and data.

### Modified Capabilities

## Impact

- Depends on `owner-auth` (account, sessions, OAuth linking).
- Backend: profile, avatar, preferences, export and delete-notes routes; preferences used by the agent loop (language) and the chat default effort.
- Frontend: `SettingsPage` split into tab components; routes; tests.
- E2E for each tab.
