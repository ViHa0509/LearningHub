## Context

- The app is plain `def` FastAPI routes with sync SQLAlchemy; the hosted copy runs on Vercel functions, so there is no long-lived connection for push.
- The events already exist: sign-up and invitation accept (`app/routes/auth.py`), `write_lesson` (`app/agent/tools.py`), the shared count (`take_shared_count`, `app/agent/resolve.py`), the provider chain's fallback (`fallback_used`, `resolve.py`) and its `ProviderError` categories, the KH reconnect error (`app/kh/`), field publish (`app/routes/fields.py`), session creation (`app/auth/sessions.py`), restore (`app/routes/data.py`, `data_upload.py`).

## Goals / Non-Goals

**Goals:** one small helper every trigger calls; a notification never breaks the event that made it; nothing untrusted rendered as markup.

**Non-Goals:** email or push delivery, per-kind mute, real-time delivery under a minute.

## Decisions

1. **Table.** `notifications (id uuid, user_id fk cascade, kind text, params jsonb, link text, dedupe_key text null, created_at, read_at null)`, index on `(user_id, created_at desc)`, unique `(user_id, dedupe_key)` where not null; RLS like every table.

2. **Text is built on the client from `kind` + `params`.** The server stores structured params (`{"name": ..., "email": ...}`), never HTML; the frontend has one text template per kind and renders params as React text. This keeps translations and wording in one place, and untrusted values can never become markup. Alternative: store the final text on the server; rejected, it mixes wording into data and old rows would keep old wording.

3. **`notify(db, user_id, kind, params, link, dedupe_key=None)`** adds the row in the caller's transaction with `INSERT ... ON CONFLICT DO NOTHING` on the dedupe key, then trims the user's rows beyond 200 and older than 90 days. It runs inside a savepoint (`begin_nested`), so a failure in notify is logged (kind and user id only) and the event still commits. Dedupe keys: limit `limit80:<day>`, `limit100:<day>`; provider `provider:<id>:<day>`; KH `kh-reconnect` (removed when the user reconnects); field `field:<id>:<day>`; sign-in has no key (the device check decides).

4. **Links** are hash routes made by the server from ids (`#/lesson/<domain>/<node>`, `#/settings/providers/<id>`, ...). The client accepts only links that start with `#/` and opens them with the router, never `window.location` to another origin.

5. **New sign-in device**: a key from the session's user agent, reduced to browser family and system (`device_of` in `app/auth/sessions.py`). New when no session of the user in the last 90 days has the same key. Only the sign-in within 10 minutes of the account's creation is skipped, so a sign-in after "log out everywhere" (no sessions left) still notifies. The address is shown, not used in the key (addresses change often).

6. **Shared limit** checks run right after `take_shared_count` with the count it returns: at `ceil(0.8 * limit)` and at `limit`; the admin never reaches this code path (no limit).

7. **Provider problems** hook into the provider chain where it records `fallback_used` and where it raises a `ProviderError` with category `auth_failed` or `rate_limited` (the code has no separate quota category; `auth_failed` never hands over to the fallback). The notice is written with its own short session, because the chat request rolls back on a `ProviderError`. Only the category and the provider's name and id go into params; members on the shared provider get none.

8. **Polling.** `GET /api/notifications/unread-count` is cheap (index); the client polls it with TanStack Query `refetchInterval: 60_000` and `refetchIntervalInBackground: false`, plus refetch on window focus; the list is fetched only when the bell opens.

9. **Room on a phone.** The bell adds one 40 px icon button to a top bar that already fills 360 px. The A2UI Lab link, the least used control, moves into the avatar menu under 640 px (CSS shows one or the other), so the lab stays reachable from the UI as its spec requires. Alternative: hide the link on phones; rejected, the lab spec says it is reached from the top bar.

## Risks / Trade-offs

- [One extra insert on hot paths (each chat request may run the shared-limit check)] → the insert happens only at the two thresholds; otherwise it is a comparison.
- [Polling every minute from every open tab] → one indexed count query; stops while the tab is hidden.
- [Sign-in device detection from the user agent is rough] → good enough for a notice; it never blocks a sign-in.
- [Notification text for a lesson topic or field comes from user data] → rendered as text only (Decision 2), covered by a test with markup in a name.

## Migration Plan

One additive migration (new table, RLS). Rollback: drop the table.
