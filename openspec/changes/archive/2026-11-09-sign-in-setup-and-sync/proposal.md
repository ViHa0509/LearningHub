## Why

The app now runs in two places: the owner's Local copy (for testing) and a Deploy copy reached through a Cloudflare Tunnel. The owner reported two gaps after trying the Deploy copy:

- **GitHub and Google sign-in cannot be switched on from the app.** Today the OAuth client id and secret can only be set as `LH_GITHUB_*` / `LH_GOOGLE_*` environment variables, followed by a restart, and nothing tells the owner which callback URL to register.
- **There is no way to move data from Local to Deploy.** The notes, original files, lessons and agent settings live in the Local database and `storage/`, and the Deploy copy starts empty.

The owner asked for both in Settings or an admin page.

## What Changes

- **Settings -> Sign-in** (`#/settings/sign-in`), for the Owner:
  - GitHub and Google, each with Client ID and Client secret, Save and Cancel, and Remove.
  - The secret is stored encrypted like provider keys and never sent back (only a hint).
  - The exact callback URL for this server (from `LH_PUBLIC_URL`) with a Copy button, and short steps with links to where the OAuth app is created.
  - Values saved here take effect at once and win over the environment variables; environment variables keep working.
- **Settings -> Data & sync** (`#/settings/data`), for the Owner:
  - **Download a backup:** a .zip with the notes and their original files, lessons, node links, archive state, AI provider configurations **without keys**, agent assignments and agent settings. No account, session, token, password or key is in it.
  - **Restore a backup:** replaces all of that data on this server after the owner types `REPLACE`. Before replacing, the server keeps an automatic backup of what it had (the last 3).
  - **Sync to another Learning Hub:** on the target (Deploy), the owner creates a **sync key** (shown once, valid 24 hours, one at a time). On the source (Local), the owner enters the target's address and that key and presses **Send**. The source builds the backup and uploads it in parts small enough for the Cloudflare request limit; the target restores it as above. The result names what was copied.
  - Provider keys are never copied; the target shows which providers need their key entered again.
- **Settings page links:** the Settings page gets links to AI providers, Sign-in and Data & sync. The full vertical tabs stay in the `settings-tabs` change, which will host these pages.

## Capabilities

### New Capabilities
- `data-sync`: backup, restore and sync of the user's data between Learning Hub servers.

- `hosted-database`: migrations lock a hosted database (RLS, no Supabase API roles) and accept URL-encoded passwords.

### Modified Capabilities
- `auth`: GitHub and Google sign-in can be set up in the app.

## Impact

- Backend:
  - new migration `0011` (`app_settings`: encrypted sign-in settings; `sync_keys`; `sync_uploads`)
  - `app/auth/oauth.py` reads the database first
  - new `app/data_sync/` (export, restore, upload parts)
  - new routes `/api/settings/sign-in` and `/api/data/*`
- Frontend: `SignInSettings.tsx`, `DataSettings.tsx`, links in the Settings page, API calls.
- The Deploy copy needs the new image; the README explains moving data with Sync and setting up GitHub and Google.
- Security: every new route needs the Owner's session, except the sync upload routes, which need a valid sync key instead. The sync key is stored only as a SHA-256 hash and compared in constant time. Uploads are size-limited, and archive entries are checked against path traversal and size.
