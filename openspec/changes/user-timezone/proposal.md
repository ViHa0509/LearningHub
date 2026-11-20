# User time zone

## Why

The app shows times (chat history, news, test results, users, backups) in the browser's time zone, and the server counts days in UTC. The owner wants each user to choose their time zone when they sign in, so the UI shows times in that zone (2026-11-19: "add a popup when the user logs in to choose the timezone, to show by the user's timezone on the UI").

## What changes

- Each user has a time zone (an IANA name such as `Asia/Ho_Chi_Minh`), empty until chosen.
- After sign-in, a user without a time zone gets a dialog that proposes the browser's zone, with **Save** and **Not now**. "Not now" keeps the browser's zone and asks again at the next sign-in.
- Settings -> Account gets a **Time zone** field with Save, to change it later.
- Every time the UI shows is formatted in the user's zone through one helper; with no zone chosen it is the browser's zone, as today.

## Not in this change

- Server-side counting by the user's zone: daily limits and "today" on the server stay UTC.
- Translating the UI or changing date formats beyond the zone.

## Impact

- Spec: `accounts` (two new requirements).
- Backend: a migration adding `users.timezone`; `GET /api/auth/me` returns it; a route to set it; `tzdata` in the requirements (Windows and slim images have no zone database).
- Frontend: sign-in dialog, Account settings field, `lib/time.ts` used by every place that formats a time (about nine files).
- E2E: the sign-in setup sets the owner's zone, so the dialog does not cover every test.
