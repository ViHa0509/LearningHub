## ADDED Requirements

### Requirement: Hosted database locked down
After every migration upgrade, every table in the database's public schema SHALL have row-level security enabled, and where the roles `anon` and `authenticated` exist (Supabase), they MUST have no rights on its tables and sequences. The app connects as the tables' owner and keeps full access. Migrations MUST accept a database URL whose password is URL-encoded (contains `%`).

#### Scenario: Tables locked after an upgrade
- **WHEN** the migrations are upgraded to head
- **THEN** no table in the public schema is without row-level security, and the app still reads and writes its data

#### Scenario: URL-encoded password
- **GIVEN** `LH_DATABASE_URL` holds a password written with `%` escapes
- **WHEN** the migrations run
- **THEN** they connect and upgrade instead of failing on the `%`
