## ADDED Requirements

### Requirement: Service unavailable page
The app SHALL check the service's health when it starts, every 30 s, and right after an API request fails with a network error or a server error. While the health check fails, it MUST show a full-page "Service unavailable" screen instead of the panels. It says whether the server or the database is unreachable and that it reconnects on its own (checked every 5 s), without retry controls; the top bar stays. When the check passes, the app MUST return to the page the user was on and reload its data.

#### Scenario: Backend down
- **GIVEN** the backend does not answer
- **WHEN** the user opens the app
- **THEN** the Service unavailable page says Learning Hub can't reach its server, with no retry button or countdown, and no "Is the backend running?" error is shown

#### Scenario: Database down
- **GIVEN** the backend answers but its database does not
- **WHEN** the health check runs
- **THEN** the health check answers 503 with reason `database` and the page says Learning Hub can't reach its database

#### Scenario: Service comes back
- **GIVEN** the Service unavailable page is shown on the lesson page of `devops/helm`
- **WHEN** the health check passes again
- **THEN** the lesson page of `devops/helm` is shown with its data, without a manual reload
