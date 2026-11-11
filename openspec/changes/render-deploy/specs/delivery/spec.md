## ADDED Requirements

### Requirement: Note files in Supabase Storage
With `LH_STORAGE_BACKEND=supabase`, the backend SHALL store, read and delete note files in a private Supabase Storage bucket (`LH_SUPABASE_URL`, `LH_SUPABASE_BUCKET`) authenticated with `LH_SUPABASE_SERVICE_KEY`, under the same content-addressed keys as the local store. The service key MUST stay on the server, never appear in logs, API answers or the frontend, and the app MUST refuse to start when the backend is supabase and a setting is missing.

#### Scenario: Import and open a note on Render
- **GIVEN** the storage backend is supabase
- **WHEN** the user imports an HTML file and opens its original page
- **THEN** the file is stored in the bucket and served from it in the sandbox, as with local storage

#### Scenario: Missing setting
- **GIVEN** `LH_STORAGE_BACKEND=supabase` and no `LH_SUPABASE_SERVICE_KEY`
- **WHEN** the backend starts
- **THEN** it refuses to start and names the missing setting

### Requirement: Run on Render
The repository SHALL define a Render Blueprint for one Docker web service using the release Dockerfile, health check `/api/health`, and environment values for the database, storage, public URL and secret key, with secrets entered in Render and not in the repository. The container MUST listen on `$PORT` when it is set, else 8080.

#### Scenario: Port from the platform
- **GIVEN** `PORT=10000`
- **WHEN** the container starts
- **THEN** the app answers on port 10000

### Requirement: Invitation links without email
When no SMTP server is configured, creating an invitation SHALL answer the invitation link once to the admin (`invite_url`), and the Users page MUST show it with a Copy button and a note to send it to the person. With SMTP configured, the link MUST NOT be returned.

#### Scenario: Copy an invite link
- **GIVEN** the server has no SMTP settings
- **WHEN** the admin invites `ana@example.test`
- **THEN** the page shows the invitation link with Copy, and opening it lets Ana create her account
