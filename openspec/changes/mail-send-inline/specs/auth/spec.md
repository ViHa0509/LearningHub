## MODIFIED Requirements

### Requirement: Magic link and email verification
The system SHALL send a single-use sign-in link valid 15 minutes to the Owner's verified email on request, and a verification link after sign-up (after an email change: see the settings capability). Every such email, and the password reset email, MUST be sent inside the request before the answer is returned, never after it. Requests for unknown emails MUST answer the same as for the Owner's, and a failed send MUST NOT change the answer of these routes; the failure is logged with the email's purpose and the exception class only. Without SMTP configured, messages are written to the local outbox folder and the page says so.

#### Scenario: Magic link
- **WHEN** the Owner requests a magic link and opens it within 15 minutes
- **THEN** they are signed in, and opening it a second time is refused

#### Scenario: Verify email
- **WHEN** the Owner opens the verification link from the sign-up email
- **THEN** their email is marked verified

#### Scenario: Mail written before the answer
- **GIVEN** no SMTP server is configured (outbox mode)
- **WHEN** the Owner requests a magic link or a password reset
- **THEN** the email file is already in the outbox folder when the answer arrives

#### Scenario: Mail server refuses the message
- **GIVEN** SMTP is configured and the mail server closes the connection
- **WHEN** the Owner requests a magic link, a password reset, signs up, or resends the verification
- **THEN** each route answers exactly as it does when the mail is sent (same status and message, and sign-up still creates the account and the session), and the server log holds the purpose and the exception class but no address, link or token
