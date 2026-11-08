## ADDED Requirements

### Requirement: Checks run on GitHub for every change
A GitHub Actions workflow SHALL run on every push to `main` and every pull request, with the backend checks (tests against Postgres, lint, format, types), the frontend checks (tests, lint, build) and the Playwright suite against its own servers and fakes. A newer run on the same branch MUST cancel an older one, and the e2e screenshots and report MUST be kept as an artifact.

#### Scenario: A failing test blocks the run
- **WHEN** a commit makes one backend test fail and is pushed
- **THEN** the backend job fails and the run is marked failed on the commit

#### Scenario: Green run
- **WHEN** a commit that passes every check locally is pushed to `main`
- **THEN** all three jobs pass on GitHub

### Requirement: Releases publish an image
Pushing a tag `v*` SHALL run the checks, build one Docker image that serves the backend API and the built frontend, push it to GitHub Container Registry as the tag's version and as `latest`, and create a GitHub Release with notes and the compose file to run it. The release workflow MUST need no secrets beyond the default token.

#### Scenario: Tag a release
- **WHEN** the owner pushes the tag `v0.1.0`
- **THEN** the image `ghcr.io/viha0509/learninghub:0.1.0` exists and a release `v0.1.0` lists the changes

### Requirement: Run a released version
The release compose file SHALL start Postgres and the app image, apply migrations at start and keep data in volumes, so the app opens on http://localhost:8080 without Python or Node installed. With a static folder configured, the backend serves the frontend: non-API paths answer the app's `index.html`, and `/api` routes are unchanged.

#### Scenario: Serve the app
- **GIVEN** the backend runs with a built frontend folder configured
- **WHEN** a browser asks for `/` and for `/api/health`
- **THEN** `/` answers the app page and `/api/health` answers the health check

#### Scenario: Without a static folder
- **GIVEN** no static folder is configured (development)
- **WHEN** a browser asks for `/`
- **THEN** the backend answers 404, as today

### Requirement: Public access through a tunnel
The app SHALL be reachable from the internet only through a Cloudflare Tunnel to the owner's machine, documented with an example configuration. When its public URL is https, the backend MUST refuse to start unless the login is required, so the app is never public without the owner login.

#### Scenario: Public without login
- **GIVEN** `LH_PUBLIC_URL` is `https://hub.example.com` and `LH_AUTH_REQUIRED` is false
- **WHEN** the backend starts
- **THEN** it refuses to start and says the login must be on for a public address

#### Scenario: Public with login
- **GIVEN** `LH_PUBLIC_URL` is https and the login is required
- **WHEN** the backend starts behind the tunnel
- **THEN** it starts, session cookies are Secure, and requests without a session are answered 401
