## ADDED Requirements

### Requirement: Loading indicator while the app starts
From the moment the page is delivered until the app can show the sign-in page or the user's content, the app SHALL show a loading indicator - a spinner and the text "Loading…" - centered on the app's background, announced as a status. The page as delivered MUST already hold the indicator, so it shows before the app's code has loaded. The spinner MUST NOT spin when the user asked for reduced motion.

#### Scenario: Before the app's code has loaded
- **WHEN** a browser receives the app's page
- **THEN** the delivered HTML holds a status element with the text "Loading…"

#### Scenario: While the session is being checked
- **GIVEN** the answer about the sign-in status or the session is slow
- **WHEN** the user opens the app
- **THEN** the indicator with "Loading…" is shown until the answer arrives, and then the page replaces it

#### Scenario: Gone once the app shows
- **WHEN** the sign-in page or the user's content is shown
- **THEN** no "Loading…" indicator of the app start is on the page

#### Scenario: Service unavailable wins
- **GIVEN** the backend cannot be reached
- **WHEN** the user opens the app
- **THEN** the service unavailable page is shown, not the indicator

#### Scenario: Reduced motion
- **GIVEN** the user asked the operating system for reduced motion
- **WHEN** the indicator is shown
- **THEN** the spinner does not rotate
