## Why

The public copy (`https://learninghub.vihc0509.workers.dev`) is served from the owner's PC through a Quick Tunnel, so it is offline whenever that PC is off. The owner wants it always available, for free and without a credit card (2026-11-11). Render's free web service runs our Docker image with no card. It has no persistent disk and sleeps when idle, so the database moves to Supabase Postgres (which the owner already has) and note files move to Supabase Storage.

## What Changes

- **File storage backend:** `LH_STORAGE_BACKEND=supabase` stores note files in a private Supabase Storage bucket instead of the local folder.
  - Settings: `LH_SUPABASE_URL`, `LH_SUPABASE_SERVICE_KEY` (server-side secret), `LH_SUPABASE_BUCKET`.
  - The `local` backend stays the default, so nothing changes for the Local copy or tests.
- **Render:** a `render.yaml` blueprint defines one free Docker web service, `learninghub`, from this repo.
  - Health check `/api/health`; it deploys on every push to `main`.
  - The secret environment values are entered by the owner in Render's dashboard and never in the repo.
- **Container:** the entrypoint listens on `$PORT` when the platform sets it (Render), else 8080.
- **No disk on Render:**
  - `LH_SECRET_KEY` is required there, so provider keys stay readable across restarts.
  - Automatic restore backups and upload parts use temporary space. The README says to keep your own downloaded backups.
- **Invitations without email:** when no SMTP is configured, creating an invitation answers the invite link once to the admin, and the Users page shows it with a Copy button. This keeps invitations usable on a server whose outbox folder nobody can read.
- **Front door:** the Cloudflare Worker forwards to the Render URL instead of a Quick Tunnel. The public address and the OAuth callbacks stay the same.
  - `deploy/worker` takes the origin as a setting.
  - The README explains switching between the Render origin and the Quick Tunnel origin.

## Capabilities

### New Capabilities

### Modified Capabilities
- `delivery`: runs on Render with Supabase Postgres and Storage; port from `$PORT`; invite links shown when there is no email.

## Impact

- **Backend:**
  - `app/storage.py` gets `SupabaseFileStore`, via httpx with an injectable transport for tests;
  - `config.py` gets the storage backend settings;
  - `main.py` chooses the store;
  - `routes/admin.py` returns `invite_url` only when the mail mode is outbox.
- **Frontend:** the Users page shows and copies `invite_url` when it is present.
- **Ops:** `render.yaml`, `docker/entrypoint.sh`, README.
- **Owner steps** (they need the owner's accounts):
  - create the Render account and the Blueprint;
  - create the Supabase bucket;
  - enter the secrets in Render;
  - after deploy, Sync data from Local.
