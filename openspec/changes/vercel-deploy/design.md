## Context

See proposal.md for the motivation. What shapes the approach:

- **Today's hosted shape:** one Docker container serves the API and the built app (`Dockerfile`, `docker/entrypoint.sh`: migrate, then uvicorn). Database: Supabase Postgres, project `bpvmjavtbjvpudopltzx`, Seoul. Note files: private Supabase bucket (`SupabaseFileStore`). Front door: the Cloudflare Worker at `https://learninghub.vihc0509.workers.dev`.
- **Vercel facts** (docs read 2026-11-12):
  - Services: beta on all plans; declared under `services` in `vercel.json`; services are internal until a top-level rewrite routes to them; the path prefix is kept; a 404 inside a service does not fall through.
  - Python: 3.12 default; FastAPI runs as one function on Fluid compute; 300 s per request on Hobby; request and buffered answer bodies capped at 4.5 MB (streamed answers are not); disk read-only except 500 MB in `/tmp`, per instance; background threads may stop when the instance shuts down.
  - Vercel's own guidance: run migrations in CI before promotion, not at app start.
- **Supabase facts:** the direct host is IPv6 only; for serverless use the transaction pooler (port 6543) with no client-side pool and no prepared statements; the session pooler (port 5432) suits migrations. KH lesson `vec_d12c24d113d3`: the direct host failed on Render for the same IPv6 reason.
- **State the app keeps in one process today:**
  - `PendingStore` (OAuth) in memory, `app/auth/oauth.py`;
  - `NewsJobs` and `SyncJobs` status in memory, run in daemon threads (`routes/news.py`, `routes/resources.py`);
  - sync upload parts in `<storage>/uploads/<id>/<index>`, up to 50 MB each (`routes/data_upload.py`), sent in 50 MB parts (`data_sync/sender.py`);
  - browser restore as one multipart body up to 2 GB (`routes/data.py`);
  - `RateLimiter` and `AuthLimiter` in memory.
- **Already fine:** sessions and tokens are in the database; `LH_SECRET_KEY` comes from the environment; the Supabase file store needs no disk.

## Goals / Non-Goals

**Goals:**
- The public address serves the app from Vercel with every feature that works on Render today, including Sync from Local and restore.
- One code path where possible; platform differences behind one setting, `LH_SERVERLESS`.
- Local development, Docker, tests and e2e keep working unchanged without the setting.

**Non-Goals:**
- Rate limits shared between instances (they stay in memory; see Risks).
- The Claude Code provider on Vercel.
- A scheduled news refresh (Vercel cron); the page already refreshes when stale.
- Direct browser-to-Supabase uploads: every file still passes through the app's checks.
- Removing the Docker image or the release workflow; they stay for running a release elsewhere.

## Decisions

### Project layout: two services in `vercel.json`
```json
{
  "services": {
    "web": { "root": "frontend/", "framework": "vite",
             "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] },
    "api": { "root": "backend/", "entrypoint": "app.main:app",
             "buildCommand": "mkdir -p _data && cp -r ../roadmaps ../news _data/" }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": { "service": "api" } },
    { "source": "/(.*)", "destination": { "service": "web" } }
  ],
  "regions": ["icn1"]
}
```
- **Why Services over the Docker image:** it is what the owner's import link selects, it is on the Hobby plan, and the documented Python path has the short cold start. A `runtime: "container"` service is documented but its plan and start time were not confirmed.
- **Why not the API serving the built app** (`LH_STATIC_DIR`): static files would then cost function time and cold starts; the `web` service serves them from the CDN.
- **Roadmaps and news files:** `config.py` reads `../roadmaps` and `../news` relative to `backend/`, which is outside the service root. The build copies them into `backend/_data/` (git-ignored) and the environment sets `LH_ROADMAPS_DIR` and `LH_NEWS_SOURCES_FILE`.
- **`LH_STATIC_DIR` stays unset** on Vercel, so the API never answers app pages; an unknown `/api/...` path is FastAPI's JSON 404.
- **Confirmed on the first production deploy (2026-11-13, project `learning-hub`, team `lhhub`):**
  - the project must use the framework preset **Services** with an empty root directory; created as a single FastAPI project with root `backend`, `vercel.json` is ignored and no frontend is built;
  - the entrypoint `app.main:app` with `root: "backend/"` works as written;
  - the SPA fallback inside the `web` service works (`/settings/data` answers the app page), and an unknown `/api/...` path is the API's JSON 404;
  - the `buildCommand` reaches `../roadmaps` and `../news`, and the relative `LH_ROADMAPS_DIR=_data/roadmaps` resolves at run time;
  - Vercel's Python build installs from `pyproject.toml` and ignores `requirements.txt` when a `pyproject.toml` exists, so the dependencies are listed in `[project].dependencies` (a test keeps them equal to `requirements.txt`);
  - builds run in `iad1`; the function runs in `icn1`.

### `LH_SERVERLESS`
- A boolean in `Settings`, default false. It is read in three places only: the engine, the two job routes, and a startup check.
- **Startup check:** serverless mode with `LH_STORAGE_BACKEND=local` refuses to start, because note files and upload parts would land in a per-instance `/tmp`.
- **Why a setting and not `VERCEL=1`:** tests can switch it on, and it names the behavior, not the vendor.

### Engine
- Serverless: `create_engine(url, poolclass=NullPool, connect_args={"prepare_threshold": None})`.
- Otherwise unchanged: `pool_pre_ping=True`.
- `LH_DATABASE_URL` on Vercel is the transaction pooler: `postgresql+psycopg://postgres.<ref>:<password>@<pooler-host>:6543/postgres?sslmode=require`.
- **Alternative considered:** `pool_size=1` (Vercel's guide). `NullPool` is Supabase's advice for transaction mode and leaves no idle connection on a frozen instance.

### Migrations and deploy order
- **Pipeline:** `ci.yml` gets a `deploy` job on pushes to `main`, after `backend`, `frontend` and `e2e`:
  1. `alembic upgrade head` with the secret `LH_MIGRATE_DATABASE_URL` (session pooler, port 5432);
  2. `curl -X POST "$VERCEL_DEPLOY_HOOK_URL"` (a Vercel Deploy Hook for `main`).
- **Vercel's own Git deploy for `main` is switched off** (`"git": { "deploymentEnabled": { "main": false } }`), so production only changes after the migration. Pull-request previews stay on Vercel's Git integration and never run migrations.
- **Why a deploy hook over the Vercel CLI in CI:** one secret URL, no token with account-wide rights.
- **Rule for migrations:** each one must keep the previous app version working (add first, remove in a later change), because the old version serves until the new build finishes.
- The job is skipped when the secrets are absent, so forks and the first setup do not fail.

### OAuth pending sign-ins in the database
- **Table `oauth_pending`:** `key_hash` (SHA-256, primary key), `provider`, `state`, `verifier_enc` (SecretBox), `next`, `expires_at`.
- `PendingStore` keeps its interface (`start`, `take`) and takes the session factory and the SecretBox; `take` deletes the row in the same transaction as it reads it (`DELETE ... RETURNING`), so a callback is single-use across instances.
- `start` deletes expired rows and keeps the 1000-row cap.
- Used in every mode: one code path, and the existing tests cover it.
- **Alternative considered:** a signed, encrypted cookie holding the whole pending sign-in. It needs no table, but it cannot be made single-use.

### Sync uploads in the file store
- **Table `sync_uploads`:** `id` (uuid), `user_id`, `kind` (`sync` or `restore`), `part_sizes` (JSONB, index to bytes), `created_at`.
- **Parts:** `FileStore.put("uploads/<id>/<index>", bytes)`. The key pattern passes `check_key`; `uploads/` never overlaps the `blobs/` keys.
- **Part route:** reads the body with a 50 MB cap as today (older senders to a non-Vercel target keep working), puts it in the store, records its size; the total-size check uses `part_sizes`.
- **Finish:** reads the parts in order from the store into a temp file while hashing, checks the SHA-256, runs `run_restore`, then deletes the parts and the row (also on failure).
- **Start:** deletes uploads older than 24 hours (rows and their parts), for this user.
- **Ownership:** every call checks the row's `user_id` against the caller; another user's id answers 404.
- **Sender:** `PART_SIZE` becomes 4 MB; the finish call gets a 300 s timeout, because the target restores inside it.
- **Browser restore:** new routes `POST /api/data/restore/upload`, `PUT /api/data/restore/upload/{id}/{index}`, `POST /api/data/restore/upload/{id}/finish` (body: `parts`, `sha256`, `confirm`), behind the session and the app header, sharing the part and finish code with the sync routes. The page slices the file into 4 MB parts and hashes it with `crypto.subtle`. The old single-body `POST /api/data/restore` is removed, so there is one restore path.
- **Alternative considered:** signed upload URLs straight to Supabase. Fewer calls, but it ties sync to Supabase and puts a storage URL in front of the browser.

### Jobs in serverless mode
- `start_refresh` and `start_sync`: in serverless mode they call `jobs.run(...)` directly and answer 202 with the final status; otherwise the thread as today.
- **Saved status:** at the end of a run the status is written to `app_settings` (`job.news`, `job.resources.<domain>`). A status read returns the in-memory job when there is one, else the saved one. `last_results` and `last_refresh_at` for the news list read the same row.
- The frontend needs no change: it already shows whatever status the POST and the next read return.
- A full news refresh reads a handful of feeds with a 10 s limit each, well under 300 s. A reference sync of a large roadmap is the longest job; see Risks.

### Upload limit
- `max_upload_bytes` already exists. `GET /api/auth/status` adds `max_upload_bytes` (not a secret; the route is open, so the login page needs no extra call later).
- The import dialog and the lesson PDF import compare `file.size` first and show "larger than N MB"; the note import sends one request per file and merges the per-file outcomes.
- Vercel: `LH_MAX_UPLOAD_BYTES=4194304` (4 MB leaves room for the multipart envelope under 4.5 MB).

### Streamed answers
- The note file route and `GET /api/data/backup` answer with a `StreamingResponse` over 1 MB chunks, keeping today's headers (`Content-Security-Policy: sandbox allow-scripts`, `nosniff`, content type, file name).
- The lesson and note PDF exports are built in the browser's print dialog, so they are not affected.

### Front door and environment
- The Worker stays in front: `deploy/worker/set-origin.ps1 https://<project>.vercel.app`. `LH_PUBLIC_URL` stays `https://learninghub.vihc0509.workers.dev`, so cookies and the OAuth callback addresses do not change.
- **Vercel environment (Production):** `LH_SERVERLESS=true`, `LH_DATABASE_URL` (port 6543), `LH_SECRET_KEY` (the same value as on Render, or saved provider keys become unreadable), `LH_STORAGE_BACKEND=supabase`, `LH_SUPABASE_URL`, `LH_SUPABASE_SERVICE_KEY`, `LH_SUPABASE_BUCKET`, `LH_PUBLIC_URL`, `LH_STORAGE_DIR=/tmp`, `LH_MAX_UPLOAD_BYTES`, `LH_ROADMAPS_DIR`, `LH_NEWS_SOURCES_FILE`.
- **Client address:** behind the Worker and Vercel the app sees a proxy address. The auth rate limit and the session list use the forwarded address; the task confirms which header arrives and that it cannot be set by the visitor.
- **Preview deployments** get no production values: without `LH_DATABASE_URL` the API does not start there, which is intended.

### Render removal
- Delete `render.yaml` and the README section "Run on Render (free)".
- In the open `render-deploy` change: remove the "Run on Render" requirement from its delta and its task 3.2, keeping the file store, `$PORT` and invitation-link requirements, so that change can be archived.

## Risks / Trade-offs

- **Services is a beta** → the app stays runnable from the Docker image; the Worker's origin can point back at a Quick Tunnel in one command.
- **Rate limits count per instance** (login 10 per minute, agent 20 per minute), so several instances allow more attempts than the setting → accepted for a personal app with scrypt hashes; a database-backed limiter is a follow-up change. The README states it.
- **A restore must fit in 500 MB of `/tmp` and 300 s** → the finish call answers "the backup is too large for this server" when the declared size exceeds the free space; larger backups restore on a Docker copy.
- **A reference sync of a large roadmap may pass 300 s** → the sync replaces rows in one transaction at the end, so a timeout keeps the old links; the command-line sync against the hosted database remains.
- **Unconfirmed Vercel details** (listed under Project layout) → the first task is a preview deploy that settles them before the rest is built on top.
- **The old app version runs during a migration** → the additive-migration rule above.
- **Cold start on Hobby** still exists (seconds, not a minute) and functions archive after two weeks idle → accepted.
- **Hobby is for non-commercial personal use** → fits today; inviting paying users would need the Pro plan.

## Migration Plan

1. Merge the app changes; they are inert without `LH_SERVERLESS`.
2. Owner: import the repository in Vercel (Services preset), enter the Production environment values, create the Deploy Hook, add `LH_MIGRATE_DATABASE_URL` and `VERCEL_DEPLOY_HOOK_URL` as GitHub secrets.
3. Push to `main`: CI migrates, then triggers the deploy. Check `/api/health` on the `vercel.app` address.
4. Point the Worker at Vercel; sign in; Sync from Local.
5. Delete the Render service.

**Rollback:** point the Worker back at Render (until it is deleted) or at a Quick Tunnel with `set-origin.ps1`. The database migrations in this change only add tables.

## Open Questions

- Which pooler host the Supabase dashboard shows for this project (`aws-0-` or `aws-1-ap-northeast-2`); the owner copies it from the Connect dialog.
