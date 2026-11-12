## ADDED Requirements

### Requirement: Started sign-ins are stored on the server's database
A started GitHub or Google sign-in (state, PKCE verifier, return route) SHALL be stored in the database so that the callback completes on any instance. It MUST be usable once and for 10 minutes, the browser MUST hold only a random key in a short-lived HttpOnly cookie, the database MUST hold only that key's SHA-256 hash, and the PKCE verifier MUST be stored encrypted.

#### Scenario: Callback on another instance
- **GIVEN** a sign-in with GitHub started on one instance
- **WHEN** GitHub's callback is handled by another instance
- **THEN** the user is signed in and returned to the route they came from

#### Scenario: Used twice
- **WHEN** the same callback is sent a second time
- **THEN** it is refused with a sign-in error and no session is created

#### Scenario: Too old
- **WHEN** a callback arrives 11 minutes after the sign-in started
- **THEN** it is refused with a sign-in error and the stored sign-in is removed
