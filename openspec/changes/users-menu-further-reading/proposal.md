# Proposal: users-menu-further-reading

## Why

Two owner remarks from 2026-11-15:

1. Settings -> Users shows two plain buttons (Disable, Delete) in every member row. Every other place in the app (note page, area header, home page) collects row actions in one "More actions" menu; the Users table should too.
2. Every lesson page ends with "Further reading: <area> on roadmap.sh". roadmap.sh only covers the built-in IT roles; on a learning-field area (for example Ô tô hạng B) the link points at a page that does not exist.

## What Changes

- Users table: a member's row gets one icon button "More actions" (`aria-haspopup="menu"`) opening an `ActionMenu` with Enable or Disable and, after a divider, Delete (danger). The admin's own row still shows "You". Confirmations and the typed-email delete box are unchanged.
- Further reading: shown only for a built-in IT role (an area with no learning field). A field area's lesson page has no Further reading line.

## Capabilities

### Modified Capabilities
- `accounts`: Users page row actions in a menu.
- `lesson-pages`: Further reading link only for the built-in roles.

## Impact

- Frontend only: `UsersSettings.tsx`, `LessonPage.tsx`, `Users.test.tsx`, lesson page tests, `index.css` if needed; e2e `members.e2e.ts` (Disable/Delete now open from the menu).
