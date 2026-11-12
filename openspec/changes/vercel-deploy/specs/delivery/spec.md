## ADDED Requirements

### Requirement: Run on Vercel
The repository SHALL define one Vercel project with two services: the built app and the API. Requests under `/api` MUST reach the API with the path unchanged, and every other path MUST reach the app, where a path that is not a file opens the app page. Secret values MUST be entered in Vercel and never stored in the repository.

#### Scenario: API and app on one address
- **GIVEN** the project is deployed on Vercel
- **WHEN** the browser opens `/` and the app calls `/api/health`
- **THEN** the app page loads and the health call answers `{"status": "ok"}` from the same address

#### Scenario: Deep link
- **WHEN** the browser opens `/settings/data` directly on the deployed address
- **THEN** the app page loads and shows that route, not a 404

#### Scenario: Unknown API path
- **WHEN** a request for `/api/nope` arrives
- **THEN** it is answered 404 as JSON by the API, not with the app page

### Requirement: Serverless mode
With `LH_SERVERLESS=true` the backend SHALL work when each request can reach a different, short-lived instance with a read-only disk outside the temporary folder: no behavior may depend on memory or local files kept between requests. Without the setting, the local and Docker behavior MUST stay as it is.

#### Scenario: Started on another instance
- **GIVEN** serverless mode and two instances of the API
- **WHEN** a GitHub sign-in or a data sync upload starts on one instance and continues on the other
- **THEN** it completes as on a single server

#### Scenario: Default mode unchanged
- **GIVEN** `LH_SERVERLESS` is not set
- **WHEN** the backend starts with the local storage backend
- **THEN** it behaves as before this change, with a connection pool and background jobs

### Requirement: Database connection in serverless mode
In serverless mode the backend SHALL connect to the database without keeping a connection pool of its own and without prepared statements, so that it works behind a transaction-mode pooler.

#### Scenario: Behind a transaction pooler
- **GIVEN** serverless mode and a database URL that points at a transaction-mode pooler
- **WHEN** several requests read and write data
- **THEN** every request succeeds and no prepared-statement error is logged

### Requirement: Jobs finish inside the request in serverless mode
In serverless mode a news refresh and a reference sync SHALL run inside the request that starts them and answer with the final status. The final status MUST be saved in the database, and a later status read on any instance MUST return it.

#### Scenario: News refresh on Vercel
- **GIVEN** serverless mode
- **WHEN** the user refreshes the news
- **THEN** the answer holds the finished status with each source's result, and reading the status afterwards on another instance returns the same result

#### Scenario: Failed reference sync
- **GIVEN** serverless mode and a sync that fails part way
- **WHEN** the status of that roadmap is read afterwards
- **THEN** it answers failed with the error, and the previous links are kept

### Requirement: Migrations before the production deploy
Database migrations for the hosted copy SHALL run from the CI pipeline on a push to `main`, after the checks pass and before the new version serves requests. The backend MUST NOT run migrations when it starts on Vercel, and a failed migration MUST stop the deploy.

#### Scenario: Migration fails
- **WHEN** the migration step fails in the pipeline
- **THEN** the pipeline fails and the production deployment is not replaced

### Requirement: Large answers are streamed
Note files and the backup download SHALL be answered as streams, so that an answer larger than the platform's buffered answer limit (4.5 MB on Vercel) is delivered whole.

#### Scenario: Open a 9 MB note on Vercel
- **GIVEN** a note whose original file is 9 MB, synced from another copy
- **WHEN** the user opens its original page on the Vercel copy
- **THEN** the whole file is shown in the sandbox
