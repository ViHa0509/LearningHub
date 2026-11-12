## 1. Backend

- [x] 1.1 `SupabaseFileStore` and storage settings; startup check; tests with a mock transport (put, get, delete, missing key, error without body in logs, key validation)
- [x] 1.2 `invite_url` in the invitation answer when there is no SMTP; tests (present with outbox, absent with SMTP)

## 2. Frontend

- [x] 2.1 Users page shows the invite link with Copy when present; Vitest

## 3. Ops

- [x] 3.1 Entrypoint `$PORT`; `render.yaml`; `deploy/worker/set-origin.ps1`; README "Run on Render (free)" with the owner's steps
- Task 3.2 (go live on Render) was dropped on 2026-11-12: the hosted copy moves to Vercel in the `vercel-deploy` change, which also removes `render.yaml` and the Render README section.
