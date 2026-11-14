# Spec Delta

## ADDED Requirements

### Requirement: Open sign-up and invitations
After the admin exists, anyone SHALL be able to create a member account, with an email and a password on the Sign up page or with GitHub or Google whose verified email has no account yet; the new account is signed in at once. An email that already has an account MUST be refused, and the email of an account that is not verified MUST NOT be linked to a GitHub or Google identity. Invitations still create verified members.

#### Scenario: Sign up with a password
- **GIVEN** the admin exists
- **WHEN** someone signs up as `ana@example.test` with a valid password
- **THEN** a member account for `ana@example.test` is created and signed in, it sees none of the admin's data, and a verification mail is sent

#### Scenario: Sign up with GitHub
- **GIVEN** the admin exists and no account has the email `ana@example.test`
- **WHEN** a GitHub account whose verified email is `ana@example.test` signs in
- **THEN** a member account is created, verified and linked to that GitHub identity

#### Scenario: Email already used
- **WHEN** someone signs up with the email of an existing account
- **THEN** it is refused with "An account with this email already exists" and no account or session is created

#### Scenario: Unverified account is not taken over
- **GIVEN** an account for `ana@example.test` whose email is not verified
- **WHEN** a GitHub account with that verified email signs in
- **THEN** it is refused, nothing is linked and no session is created

#### Scenario: Sign up page
- **WHEN** a signed-out visitor opens the login page
- **THEN** it links to a Sign up page with display name, email, password and its confirmation, and Continue with GitHub or Google

#### Scenario: Invited by email
- **GIVEN** the admin invited `ana@example.test`
- **WHEN** Ana opens the invitation link and sets a password
- **THEN** a member account for `ana@example.test` is created, verified, signed in, and the invitation cannot be used again

## REMOVED Requirements

### Requirement: Invite only
**Reason**: The owner opened sign-up (2026-11-13); invitations stay as one way in.
**Migration**: Covered by "Open sign-up and invitations".
