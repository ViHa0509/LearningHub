## Context

Two copies of the app: Local (owner's PC, dev DB on 5434, `storage/`) and Deploy (release image, own DB and `/data` volume, behind a Cloudflare Tunnel). OAuth providers are read from `Settings` in `app/auth/oauth.py:60-75`. User data lives in `notes` (+ content-addressed blobs `blobs/<sha[:2]>/<sha><suffix>` in the file store), `lessons`, `ai_providers`, `agent_providers`, `agent_settings`. `node_resources` and `news_items` are re-fetchable caches and are not copied.

## Decisions

### Sign-in settings
- Table `app_settings(key text pk, value jsonb, secret_enc text null, updated_at)`. Keys `oauth.github`, `oauth.google`; `value = {"client_id": ...}`, `secret_enc` = SecretBox-encrypted client secret.
- `oauth.provider_config(name, settings, db)` returns the DB row when present, else the environment values. `/api/auth/status` and `/start`/`/callback` use it, so a save works at once.
- Routes (Owner session, `X-LearningHub` on writes):
  - `GET /api/settings/sign-in` -> `{public_url, providers: {github: {client_id, secret_hint, source: "app"|"env"|null, callback_url}, google: {...}}}`
  - `PUT /api/settings/sign-in/{provider}` `{client_id, client_secret?}` (secret optional on change: keep the old one); 422 for empty or over 200 characters.
  - `DELETE /api/settings/sign-in/{provider}` removes the app value (env value, if any, applies again).
- `secret_hint` uses `key_hint` from `app/agent/secrets.py`. Never log the secret.

### Backup format (`learninghub-backup-<UTC timestamp>.zip`)
- `manifest.json`: `{format: 1, app_version, migration: "<alembic head>", created_at, counts: {notes, files, lessons, providers, agent_providers, agent_settings}}`
- `data/notes.json`, `data/lessons.json`, `data/ai_providers.json` (all columns except `api_key_enc`, `key_hint`, `key_kind` and `last_*` test fields), `data/agent_providers.json`, `data/agent_settings.json`. Ids, timestamps and `archived_at` are kept; datetimes in ISO 8601.
- `files/<storage_key>` for every note blob.
- Built in a temp file (`zipfile`, deflate), streamed with `FileResponse`.

### Restore
- Validate before touching anything:
  - zip entries are only `manifest.json`, `data/*.json` and `files/blobs/<2 hex>/<64 hex><suffix>`; no absolute path or `..`
  - total uncompressed size at most 2 GB and at most 20,000 entries
  - `format == 1`, `migration` not newer than this server's head
  - each file's SHA-256 equals its name
  - JSON shapes are checked with Pydantic
- Then:
  - write an automatic backup to `<storage>/backups/auto-<ts>.zip` and keep the newest 3
  - write the blobs (content-addressed, so existing ones are skipped)
  - in one transaction, delete `agent_providers`, `agent_settings`, `lessons`, `notes` and `ai_providers`, then insert the backup's rows
  - providers come back with no key: `api_key_enc` null, so the UI's existing "no key" state shows; `claude-code` and local types need no key
- Answer `{counts, providers_needing_key: [names]}`.
- Routes:
  - `GET /api/data/backup` (Owner)
  - `POST /api/data/restore` (Owner, multipart file, form field `confirm=REPLACE`, else 422)

### Sync key and upload
- Table `sync_keys(id, token_hash text, created_at, expires_at)`; creating one deletes the others.
  - `POST /api/data/sync-key` (Owner) answers the key once; it is 32 random bytes, urlsafe.
  - `DELETE /api/data/sync-key` revokes it.
  - `GET /api/data/sync-key` -> `{active, expires_at}`.
- Upload routes need `Authorization: Bearer <key>` (hash compared in constant time, not expired) and no session. Every other route ignores the header, because `require_session` reads only the cookie.
  - `POST /api/data/upload` -> `{upload_id}`
  - `PUT /api/data/upload/{id}/{index}`: raw body at most 50 MB, written to `<storage>/uploads/<id>/<index>`
  - `POST /api/data/upload/{id}/finish` `{parts, sha256}`: joins the parts, checks the SHA-256, restores as above, deletes the parts, answers the restore result
  - Uploads older than 24 hours are removed when a new one starts.
- Sender, `POST /api/data/sync` (Owner) `{target_url, key}`:
  - The URL must be https, or http on `localhost` or `127.0.0.1`.
  - It builds the backup, then uses `httpx` with no redirects and a 60 s timeout per call to start, send 50 MB parts and finish.
  - It answers the target's result, or a clear error: unreachable, 401 "the sync key is wrong or expired", or 413.
  - The key is never logged or stored on the source.
- `X-LearningHub: 1` is sent on the upload calls too.

### Frontend
- `#/settings/sign-in` (`SignInSettings.tsx`): one card per provider:
  - status (Not configured / From the environment / Set in the app)
  - Client ID input and Client secret input (password type, placeholder shows the hint)
  - Save (disabled until changed), Cancel, Remove
  - the callback URL in a read-only field with Copy
  - steps with links: https://github.com/settings/developers and https://console.cloud.google.com/apis/credentials
- `#/settings/data` (`DataSettings.tsx`): three sections:
  - **Backup:** a Download link.
  - **Restore:**
    - a file input and a confirm text field; the Restore button is enabled only when the text is `REPLACE`
    - the result lists the counts and the providers needing a key
  - **Sync:**
    - Receive: Create sync key shows the key once with Copy and the expiry, plus Revoke
    - Send: target address and key fields, then Send; while sending it shows "Sending…", then the counts or the error
- The Settings page gets a small nav: AI providers, Sign-in, Data & sync.

## Risks

- **Cloudflare free plan:** request bodies are limited to 100 MB. Parts are 50 MB.
- **Restore replaces data written on the target.** The automatic backup and the typed REPLACE limit the damage.
- **A leaked sync key** allows replacing the data for at most 24 hours. It is shown once, only one exists at a time, it can be revoked, and an automatic backup is taken before every restore.
