## Context

- `users` already has `display_name`, `bio`, `avatar_key` and `preferences` (JSONB) (`app/db.py`). `me_out` returns `display_name`, `bio`, `linked`, and `avatar_url` is hard-coded to None (`app/routes/auth.py`).
- Change password (`POST /api/auth/password`) and sessions (`GET /api/auth/sessions`, revoke, logout-others) exist and are tested, but no screen calls them.
- The admin's member delete (`DELETE /api/admin/users/{id}`, `app/routes/admin.py`) removes the user (cascade) and then deletes stored files no other note uses.
- OAuth routes are sign-in only (`/api/auth/oauth/{provider}/start` and `/callback`); identities live in a linked-identity table.
- Effort is kept in local storage (`lib/agentPrefs.ts`); the agent prompt says "Reply in the language the user writes in" (`app/agent/loop.py`).

## Goals / Non-Goals

**Goals:** reuse the existing auth pieces; one deletion path for a member's data; untrusted avatar files never run as anything but an image.

**Non-Goals:** changing the admin's Users page, a theme saved to the account, a separate export, new sign-in providers.

## Decisions

1. **Member data deletion is shared.** The cascade-and-release code of `delete_user` moves to one helper used by the admin route and `DELETE /api/auth/account`. The account route takes `{confirm_email}`, refuses the admin (422, same message as Users), deletes, and clears the session cookie.

2. **Avatar.** `POST /api/auth/avatar` (multipart, ≤ 1 MB read with a hard cap, never the whole body first). The type comes from magic bytes (PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF....WEBP`); the file name and the sent content type are ignored. Stored under a content key in the file store (`avatars/<sha256>`), `users.avatar_key` set; the old one deleted when no user uses it. `GET /api/auth/avatar/{user_id}` needs a session, answers only for the current user or users the current user can see (admin: all; member: self), with the stored type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` and `Cache-Control: private`. `me_out.avatar_url` points to it with the key as a cache-buster. Alternative: re-encode with Pillow to strip metadata; rejected for now (a new dependency; the content check and headers are enough to stop script execution). EXIF location data stays in JPEGs: noted in Risks.

3. **Email change.** `POST /api/auth/email` `{new_email}` creates a single-use token (SHA-256 stored, 24 h) with the purpose `email_change` and the new address, sends the link to the new address and a notice to the old one, and answers the same whether the address is free or not. `POST /api/auth/email/confirm` `{token}` checks the token, refuses an address now used by another account (409), sets the email and `email_verified_at`, and ends the user's other sessions. If the token table has no purpose or payload column, a small migration adds them (main session).

4. **Link and unlink.** `GET /api/auth/oauth/{provider}/link/start` needs a session and the app header is not possible on a redirect, so it puts the session's id hash into the OAuth `state` (signed like the sign-in state) with `mode=link`. The callback, in link mode, checks that the current session matches the state, refuses an identity that belongs to another user (409 page message), and adds the identity. `DELETE /api/auth/identities/{provider}` refuses when it is the last method (a password counts as a method). Sign-in mode is unchanged.

5. **Preferences.** `PUT /api/auth/preferences` `{answer_language: auto|en|vi, default_effort: low|medium|high}` merges into `users.preferences`; `me_out` returns them. The chat route reads the language and adds one line to the system prompt ("Answer in Vietnamese." / "Answer in English."); Auto keeps today's line. The composer's effort starts from `default_effort` for a new chat; the local storage value stays as the per-device last pick within a chat.

6. **Delete all notes.** `DELETE /api/notes` `{confirm: "DELETE"}` collects the user's storage keys, deletes the notes (links cascade), and releases each key through `release_blob`.

## Risks / Trade-offs

- [JPEG avatars keep their EXIF data, which may include a location] → the upload hint says so; re-encoding is a later change.
- [A link-mode callback could attach an identity to the wrong account if the state were not bound] → the state carries the session hash and is single use.
- [Email change to an address of another account could be used to probe accounts] → the request answers the same either way; only the confirm step refuses.
- [Self-delete is irreversible] → typed email, and only members; the admin keeps the backup feature.

## Migration Plan

No migration unless the email token table lacks a purpose or payload column (Decision 3); then one additive migration, no data rewrite.
