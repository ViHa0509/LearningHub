## Why

Things happen in the app that the user does not see unless they look in the right place at the right time. A lesson the agent finished writing while they were on another page, a shared provider limit about to run out, a new member who signed up (for the admin), a failing provider key. The owner asked (2026-11-23) for notifications: new users for the admin, LLM usage limits, a lesson the agent just wrote, and more that fit the system.

## What Changes

- A **bell** in the top bar with the number of unread notifications. It opens a list, newest first, where each item shows its text and time (in the user's time zone). Clicking an item marks it read and opens its page. There is also a **Mark all read** action.
- Notifications are stored per user, kept 90 days (at most 200 per user, oldest dropped). The app checks for new ones every 60 seconds while the tab is visible, and when the tab gets focus again. The hosted app runs on Vercel functions, so there is no push channel.
- Notifications in this change, each tied to an event that exists today:

  | # | Who | When | Text (example) | Opens |
  |---|---|---|---|---|
  | 1 | admin | an account is created by open sign-up or an accepted invitation | "New member: Lan (lan@example.com) joined" | Settings > Users |
  | 2 | user | the agent wrote or replaced a lesson (lesson writer or the assistant's write tool) | "Lesson ready: backend/graphql" | the lesson |
  | 3 | member | 80% of the shared daily limit used, and again when the limit is reached (once each per day; never for the admin) | "You used 16 of 20 shared requests today; resets 07:00" | Settings > AI providers |
  | 4 | user | the primary provider failed and the fallback answered, or a provider failed with an invalid key or quota (once per provider per day) | "Provider 'Work Claude' failed (invalid key); the fallback answered" | the provider page |
  | 5 | user | the Knowledge Hub connection needs to be connected again | "Knowledge Hub needs reconnecting" | Settings > Agents |
  | 6 | member | the admin published a field | "New field published: Finance" | the home page on that field |
  | 7 | user | a sign-in to the account from a device and browser not seen before | "New sign-in: Edge on Windows, 1.2.3.4" | Profile > Security (Settings > Account until the Profile page ships) |
  | 8 | user | a backup was restored into the account (restore or a sync upload) | "Data restored from a backup: 120 notes, 14 lessons" | the home page |

- Names, titles and devices in a notification are shown as plain text. A notification opens only a page inside the app.
- Out of scope (later): email or browser push, per-kind mute (it belongs in Profile > Preferences once that page ships), notifications for news, imports or chat answers (the chat already shows those).

## Capabilities

### New Capabilities
- `notifications`: the notification store, the bell and its list, read state, retention, and the eight notification kinds with their triggers.

### Modified Capabilities
- none (the triggering features keep their behaviour; each only adds a notification)

## Impact

- Backend: new table `notifications` (migration, RLS), `app/notifications.py` with one `notify(...)` call used at each trigger (auth sign-up and invitation accept, `write_lesson`, the shared count, the provider chain's fallback and error path, the KH reconnect path, field publish, session creation, restore), routes `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/{id}/read`, `POST /api/notifications/read-all`.
- Frontend: `NotificationBell` in `TopBar`, a query that polls the unread count, the list popover, Vitest.
- Tests: pytest per trigger and for isolation between users; e2e for the bell with triggers the e2e setup can produce (sign-up, lesson written by the fake LLM, shared limit, field publish, new sign-in).
