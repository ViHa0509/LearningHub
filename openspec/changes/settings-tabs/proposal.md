## Why

Settings grew page by page, with its tabs as a row above the content while the left column keeps showing the Learned list, which has nothing to do with settings. A signed-in person also has no place for their own account: name, bio and avatar cannot be edited, the email cannot be changed or verified from a page, and password, sessions and sign-in methods have backend routes but no screen. First written for a single owner; rewritten 2026-11-23 for admin + members, and again the same day on the owner's request: a separate Profile page, and both pages navigated from the left column.

## What Changes

- **Left-column navigation.** On Settings and on Profile, the left column (where the Learned list sits on other pages, same width, collapse and phone drawer behaviour) shows that page's sections instead of the Learned list, with the current one marked. The row of tabs above the content goes away.
  - Settings sections: **AI providers**, **Agents**, **Users** (admin), **Sign-in** (admin), **Data & sync**. Addresses stay as today (`#/settings`, `#/settings/agents`, `#/settings/users`, `#/settings/sign-in`, `#/settings/data`, provider pages).
  - The **Account** section leaves Settings; `#/settings/account` opens Profile.
- **Profile page** (`#/profile`, opened from a new "Profile" item in the avatar menu, for every user), sections:
  - **General** (`#/profile`): avatar (PNG, JPEG or WebP up to 1 MB, checked by content; Remove goes back to initials), display name, bio, email with its verification state (Verify email resends the link; Change email sends a link to the new address and changes it only when opened), time zone (moved from Account).
  - **Security** (`#/profile/security`): change or set password, linked sign-in methods (password, GitHub, Google) with Link and Unlink (never the last one), active sessions with Revoke and Log out everywhere else.
  - **Preferences** (`#/profile/preferences`): the agent's answer language (Auto, English, Vietnamese) and the default effort for new chats.
  - **Delete account** at the bottom of General, members only: after typing their email, the account and all its data are removed, as when the admin deletes a member. The admin cannot delete their own account.
- **Data & sync** gets **Delete all notes** (typed DELETE): only the user's notes and links; lessons stay; shared files released only when unused.
- Every form has Save and Cancel and asks before discarding changes.
- Dropped: a separate export (the backup .zip covers it), a theme preference on the account (the top bar switch stays).

## Capabilities

### New Capabilities
- `settings`: the left-column navigation of Settings, the Profile page with General, Security and Preferences, account deletion by a member, and Delete all notes.

### Modified Capabilities
- none (the auth spec sends email change to this capability; change password and sessions keep their auth requirements and get a screen here)

## Impact

- Backend: `PUT /api/auth/profile`, avatar upload/read/delete, email change request and confirm, `DELETE /api/auth/account`, GitHub/Google link from a signed-in session and unlink, `PUT /api/auth/preferences` (existing `users.preferences` JSONB), the language line in the agent prompt, `DELETE /api/notes`. No migration expected (`users` has `display_name`, `bio`, `avatar_key`, `preferences`); one only if the email token table lacks a purpose/payload column.
- Frontend: `AppShell` picks the left column per page (`LearnedList`, `SettingsNav`, `ProfileNav`); new `ProfilePage` with `ProfileGeneral`, `ProfileSecurity`, `ProfilePreferences`; `route.ts` (`#/profile...`, `#/settings/account` → Profile); "Profile" in `AccountMenu` and the avatar image; `SettingsNav` moves into the left column; Delete all notes in `DataSettings`; the composer's starting effort from the account.
- Security: avatar files are untrusted (content check, `nosniff`, image type, session only); email change and link use single-use hashed tokens and session-bound state; nothing secret is logged.
