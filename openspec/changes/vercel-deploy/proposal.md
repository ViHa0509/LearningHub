## Why

The hosted copy on Render's free plan sleeps when idle, and the first request afterwards waits about a minute for the container to start (owner, 2026-11-12). Vercel starts a Python function in seconds and has a free plan, so the hosted copy moves there. Vercel runs the backend as a serverless function, not as one long-lived container, and several parts of the app assume one process with a writable disk; those parts change here so nothing is broken on the public address.

## What Changes

- **Vercel project:** a `vercel.json` with two services in one project: the Vite app (`frontend/`) and the FastAPI app (`backend/`, routed under `/api`, region Seoul next to the database). Deep links to app pages open the app.
- **Serverless mode:** a new setting `LH_SERVERLESS=true` (set on Vercel only) switches the behaviors below that depend on the platform. Local, Docker and tests keep today's behavior.
- **Database connection:** in serverless mode the app opens no connection pool of its own and does not use prepared statements, so it works behind Supabase's transaction pooler (port 6543).
- **Migrations:** `alembic upgrade head` runs from GitHub Actions before the production deploy, not at app start.
- **Data sync, BREAKING for older senders against a Vercel target:**
  - the source sends parts of at most 4 MB (was 50 MB), because Vercel refuses request bodies over 4.5 MB;
  - the target keeps the parts in the file store (the Supabase bucket on Vercel), not on local disk, with a database row per upload;
  - restoring a backup from the browser also uploads in parts, behind the session.
- **Upload limit:** `LH_MAX_UPLOAD_BYTES` (already a setting, 10 MB by default) is set to 4 MB on Vercel. The app tells the browser the limit, the browser refuses a larger file before sending, and sends one file per request.
- **Large answers:** note files and the backup download are streamed, so answers over 4.5 MB still work.
- **GitHub and Google sign-in:** the started sign-in (state, PKCE verifier, return route) is stored in the database instead of in memory, so the callback works on any instance.
- **News refresh and reference sync:** in serverless mode the job runs inside the request and its final status is saved in the database, instead of a background thread and in-memory status.
- **Local disk:** on Vercel `LH_STORAGE_DIR=/tmp`; the outbox and automatic restore backups there are temporary.
- **Front door:** the Cloudflare Worker's origin points at the Vercel address (`deploy/worker/set-origin.ps1`), so the public address, `LH_PUBLIC_URL` and the OAuth callbacks stay the same.
- **Render removed:** `render.yaml` and the README's Render section go; the open `render-deploy` change drops its "Run on Render" requirement and its task 3.2.
- **Not available on Vercel (documented):** the Claude Code provider type (as on Render); rate limits count per instance.

## Capabilities

### New Capabilities

### Modified Capabilities
- `delivery` (introduced by the open `ci-cd` change): runs on Vercel as two services; serverless mode; migrations from CI; Render removed.
- `data-sync`: parts of at most 4 MB kept in the file store; browser restore in parts.
- `knowledge-import`: the size limit is the server's upload limit, checked in the browser first; one file per request.
- `auth`: a started GitHub or Google sign-in is stored in the database.

## Impact

- **Backend:**
  - `config.py` (`serverless`), `db.py` (engine options), `main.py`;
  - `routes/data_upload.py`, `routes/data.py`, `data_sync/sender.py` (parts in the store, 4 MB, session restore upload);
  - `auth/oauth.py`, `routes/auth.py` (pending sign-ins in the database; upload limit in the status answer);
  - `routes/news.py`, `routes/resources.py`, their job classes (inline run, saved status);
  - `routes/notes.py` (streamed file answers);
  - one Alembic migration: `oauth_pending`, `sync_uploads`.
- **Frontend:** import sends one file per request and checks the limit; Data & sync restore uploads in parts.
- **Ops:** `vercel.json`, `.github/workflows` (migrate before deploy), `deploy/worker`, README "Run on Vercel"; `render.yaml` removed.
- **Owner steps** (they need the owner's accounts): import the repository in Vercel, enter the environment values, add the database URL as a GitHub secret, point the Worker at Vercel, then Sync from Local.
- **Limits accepted:** Hobby plan is for personal, non-commercial use; 300 s per request; `/tmp` holds 500 MB, which caps the size of a restore on Vercel.
