## ADDED Requirements

### Requirement: One Owner account
The system SHALL allow creating exactly one account, the Owner, by email sign-up or by GitHub or Google while no account exists. Once the Owner exists, sign-up MUST be refused, and GitHub or Google MUST only sign in an identity linked to the Owner or one whose verified email equals the Owner's verified email (which links it).

#### Scenario: First visit
- **GIVEN** no account exists
- **WHEN** the user opens the app
- **THEN** the page offers to create the owner account with email and password, GitHub or Google

#### Scenario: Sign-up closed
- **GIVEN** the Owner exists
- **WHEN** someone posts a sign-up
- **THEN** it is refused and no account is created

#### Scenario: Unknown GitHub identity
- **GIVEN** the Owner exists with a different verified email
- **WHEN** a GitHub account signs in
- **THEN** it is refused with "This app has an owner already" and no session is created

### Requirement: Email and password
The system SHALL let the Owner sign up with email and a password of at least 10 characters (confirmed), log in, log out, change the password, and reset a forgotten password with a single-use link valid 30 minutes. Passwords MUST be stored only as salted scrypt hashes, and a wrong email and a wrong password MUST give the same message.

#### Scenario: Log in and out
- **GIVEN** the Owner signed up with `me@example.test`
- **WHEN** they log in with the right password, then log out
- **THEN** the app opens after login, and after logout the API answers 401 and the login page shows

#### Scenario: Wrong password
- **WHEN** someone logs in with a wrong password or an unknown email
- **THEN** both get "Wrong email or password" and no session

#### Scenario: Reset password
- **WHEN** the Owner asks for a reset and opens the link within 30 minutes
- **THEN** they can set a new password once, the old one stops working, and other sessions are logged out

### Requirement: Sign in with GitHub or Google
The system SHALL offer GitHub and Google sign-in through the authorization code flow with state and PKCE, using only a verified email from the provider. A provider without configured client ID and secret MUST show as unavailable with the reason.

#### Scenario: Sign in with GitHub
- **GIVEN** the Owner's GitHub identity is linked
- **WHEN** they choose Continue with GitHub and approve
- **THEN** they are signed in and land on the page they were on

#### Scenario: Forged callback
- **WHEN** a callback arrives with a state that does not match the one set for this browser
- **THEN** it is refused and no session is created

#### Scenario: Not configured
- **GIVEN** no Google client ID is configured
- **WHEN** the login page shows
- **THEN** Continue with Google is disabled with a note saying it is not configured

### Requirement: Magic link and email verification
The system SHALL send a single-use sign-in link valid 15 minutes to the Owner's verified email on request, and a verification link after sign-up and after an email change. Requests for unknown emails MUST answer the same as for the Owner's. Without SMTP configured, messages are written to the local outbox folder and the page says so.

#### Scenario: Magic link
- **WHEN** the Owner requests a magic link and opens it within 15 minutes
- **THEN** they are signed in, and opening it a second time is refused

#### Scenario: Verify email
- **WHEN** the Owner opens the verification link from the sign-up email
- **THEN** their email is marked verified

### Requirement: Sessions protect the app
Every API route except health and the auth routes SHALL require a valid session cookie (HttpOnly, SameSite=Lax, stored only as a hash, sliding 30 days). The Owner MUST be able to list sessions, revoke one, and log out everywhere else. Auth requests MUST be rate-limited per IP and email.

#### Scenario: No session
- **WHEN** a request without a session calls `GET /api/notes`
- **THEN** it is answered 401

#### Scenario: Log out everywhere else
- **GIVEN** the Owner is signed in on two browsers
- **WHEN** they choose Log out everywhere else in one
- **THEN** the other browser's next request is answered 401

#### Scenario: Too many attempts
- **WHEN** 11 failed logins arrive within a minute from one address
- **THEN** the 11th is refused with a too-many-requests error that says when to try again

### Requirement: Avatar menu
When signed in, the top bar SHALL show the Owner's avatar (uploaded image or initials) and display name in a menu with Settings and Log out.

#### Scenario: Log out from the menu
- **WHEN** the Owner chooses Log out in the avatar menu
- **THEN** the session ends and the login page shows
