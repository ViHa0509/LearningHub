# Design

## Context

- `users` has no time zone. `GET /api/auth/me` (`app/routes/auth.py:231`, `MeOut`) is what the frontend reads after sign-in.
- The frontend formats times with `toLocale*` / `Intl` in about nine files (`HistoryList.tsx`, `DataSettings.tsx`, `LessonReferences.tsx`, `NewsPage.tsx`, `PracticePage.tsx`, `ProviderPage.tsx`, `UsersSettings.tsx`, `lib/providers.ts`), each in the browser's zone.
- The backend requirements have no `tzdata`; Python's `zoneinfo` has no zone database on Windows without it.

## Decisions

1. **Column**: `users.timezone text null` in a new migration (the next free number when the task is built).
2. **API**
   - `MeOut` gains `timezone: str | null`.
   - `PUT /api/auth/timezone` (session, app header) with `{"timezone": "<IANA name>"}` -> 200 `MeOut`. The name must be in `zoneinfo.available_timezones()`, at most 64 characters; otherwise 422 `unknown time zone`. `null` is not accepted: once chosen, a zone can be changed, not removed.
   - Only the signed-in user's own row is changed.
3. **Sign-in dialog.** Shown by the app shell when `me.timezone` is null and the user has not dismissed it in this browser session (`sessionStorage`, cleared at sign-out). Title "Your time zone", one line of explanation, a select of `Intl.supportedValuesOf('timeZone')` with the browser's zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) preselected, buttons **Save** and **Not now**. Save is enabled at once, because the proposed value differs from the stored empty one. Escape and "Not now" close without saving. Nothing is saved without a click on Save. A failed save shows the error in the dialog and keeps it open. The dialog never blocks sign-in itself: it opens over the signed-in app.
4. **Settings -> Account**: a "Time zone" select with Save and Cancel under the app's Save rule (Save disabled until changed).
5. **Formatting.** `frontend/src/lib/time.ts` exports the formatters the app uses (date, date and time, time, relative day) and takes the zone from the signed-in user (`me.timezone ?? browser zone`). Every existing `toLocale*` / `Intl.DateTimeFormat` call for a timestamp moves to it. A zone the browser does not know falls back to the browser's zone instead of throwing.
6. **Server stays UTC.** Stored times, logs and day counters do not change. Where the UI shows a server day boundary (for example a daily limit's reset), the API gives the instant in UTC and the UI formats it in the user's zone.
7. **Tests.** Backend tests and `fakeApi.ts` give the default signed-in user a zone, so existing tests see no dialog; new tests cover the empty case. E2E: `owner.setup.ts` sets the owner's zone through the API after signing in; the dialog's own e2e uses a fresh member.
8. **Backup.** The zone is account data and is not in the backup archive, like the rest of `users`.

## Risks

- A dialog right after sign-in can cover a page a test or a user expects: handled by decision 7 and by "Not now".
- The browser's zone list differs slightly between browsers; the server's list decides what is valid, and an unknown name is refused with a message.
