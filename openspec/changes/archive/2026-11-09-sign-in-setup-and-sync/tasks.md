## 1. Backend

- [x] 1.1 Migration 0011 (`app_settings`, `sync_keys`), models; `oauth.provider_config` reads the database first; `/api/settings/sign-in` GET, PUT, DELETE; tests (scenarios of "Set up GitHub and Google sign-in in the app")
- [x] 1.2 `app/data_sync/` backup and restore with validation and automatic backups; `GET /api/data/backup`, `POST /api/data/restore`; tests (Download a backup, Restore a backup)
- [x] 1.3 Sync key routes, upload routes (Bearer key, parts, finish), sender `POST /api/data/sync` with an injectable transport; tests (Sync to another Learning Hub, two apps in one test)
- [x] 1.4 `alembic/env.py`: `%` in the database URL escaped; RLS on every public table and no rights for `anon`/`authenticated` after each upgrade; tests

## 2. Frontend

- [x] 2.1 Settings nav (AI providers, Sign-in, Data & sync) and routes `#/settings/sign-in`, `#/settings/data`
- [x] 2.2 `SignInSettings.tsx` with Save, Cancel, Remove, Copy; Vitest for its scenarios
- [x] 2.3 `DataSettings.tsx` (Download, Restore with REPLACE, sync key, Send); Vitest for its scenarios

## 3. Docs and E2E

- [x] 3.1 README: set up GitHub and Google from Settings, move data with Sync; CLAUDE.md convention line
- [x] 3.2 qc-e2e for both pages (sync sent to the e2e backend itself); loop until the full suite passes
