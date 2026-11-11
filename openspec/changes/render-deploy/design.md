## Context

- **Release image:** one container serves the API and the built app (`Dockerfile`, `docker/entrypoint.sh`, which runs migrations then uvicorn on 8080).
- **File store:** `FileStore` is a protocol (`put`, `get`, `delete`) in `app/storage.py`, and `main.py` builds `LocalFileStore(settings.storage_dir)`. Notes use content-addressed keys `blobs/<2 hex>/<sha><suffix>`.
- **Render free web services:** Docker is supported; they spin down when idle; the filesystem is ephemeral; `PORT` is set by the platform.
- **The owner's Supabase project:** `bpvmjavtbjvpudopltzx`, Seoul. KH notes say to use the Session pooler on port 5432, the `postgresql+psycopg://` prefix and `sslmode=require`.

## Decisions

### SupabaseFileStore
- **Storage REST API with the service key:**
  - **Upload:** `POST {url}/storage/v1/object/{bucket}/{key}`, with headers `Authorization: Bearer <key>`, `apikey: <key>` and `x-upsert: true`, and the raw bytes as the body (content type `application/octet-stream`).
  - **Read:** `GET {url}/storage/v1/object/{bucket}/{key}`.
  - **Delete:** `DELETE {url}/storage/v1/object/{bucket}` with body `{"prefixes": [key]}`.
- **Errors:**
  - a 404 on `get` raises `FileNotFoundError`, like the local store;
  - other non-2xx answers raise a `StorageError` without the response body in the log;
  - `delete` of a missing key is fine.
- **HTTP client:** `httpx2.Client`, which is already a dependency, with a 30 s timeout and no redirects. Tests pass a `MockTransport`.
- **Keys** are validated with the same pattern as local, so there is no path traversal into the bucket.
- **Startup:** `config.py` adds `storage_backend: Literal["local","supabase"] = "local"`, `supabase_url`, `supabase_service_key: SecretStr | None` and `supabase_bucket = "learninghub"`. `main.py` builds the store and raises at startup if a supabase setting is missing.
- **Placement:** the bucket is created **private** by the owner. Notes are always served through the app (sandbox and CSP), never by a public bucket URL.

### Port
- **Entrypoint:** `--port "${PORT:-8080}"`.
- **Forwarded IPs:** default `--forwarded-allow-ips` stays `${LH_FORWARDED_ALLOW_IPS:-127.0.0.1}`. On Render, set `LH_FORWARDED_ALLOW_IPS=*` because Render's proxy is in front.

### render.yaml
```yaml
services:
  - type: web
    name: learninghub
    runtime: docker
    plan: free
    dockerfilePath: ./Dockerfile
    healthCheckPath: /api/health
    autoDeploy: true
    envVars:
      - key: LH_DATABASE_URL        # Supabase Session pooler, postgresql+psycopg://...?sslmode=require
        sync: false
      - key: LH_SECRET_KEY          # keep fixed: decrypts saved provider keys
        sync: false
      - key: LH_STORAGE_BACKEND
        value: supabase
      - key: LH_SUPABASE_URL
        value: https://bpvmjavtbjvpudopltzx.supabase.co
      - key: LH_SUPABASE_SERVICE_KEY
        sync: false
      - key: LH_SUPABASE_BUCKET
        value: learninghub
      - key: LH_PUBLIC_URL
        value: https://learninghub.vihc0509.workers.dev
      - key: LH_FORWARDED_ALLOW_IPS
        value: "*"
```
The project URL is not a secret; the anon key is not used.

### Invitation link without SMTP
- `POST /api/admin/invitations` adds `invite_url` to its answer only when `mailer_from_settings` is the outbox, meaning no SMTP. The mail is still written to the outbox.
- The Users page shows "No email server is set up: send this link to <email>" with a read-only field and Copy. The link is shown only in that answer and not again in the list.

### Worker origin
- `deploy/cloudflared/start-public.ps1` keeps the Quick Tunnel mode.
- A new `deploy/worker/set-origin.ps1 <url>` deploys the Worker with `ORIGIN=<url>`. After Render is live: `set-origin.ps1 https://learninghub.onrender.com` (the actual Render URL).
- The Worker already forwards `x-forwarded-*` and `redirect: 'manual'`.

### Data
After the first deploy, the owner signs up as admin on the public address (the empty database makes the first account the admin), then uses Settings -> Data & sync to Send from Local. Restore writes the files through the store, so they land in the bucket.

## Risks

- **Render sleeping:** the first request after an idle period takes about a minute. The Worker waits; Cloudflare's limit is long enough.
- **Free plan limits** (hours per month, bandwidth): enough for personal use; the README links them.
- **Ephemeral disk:** automatic restore backups and the outbox are lost on restart. The README says to download backups.
- **The service key bypasses RLS on Storage:** it is server-only, entered as a Render secret, and never sent to the browser.
