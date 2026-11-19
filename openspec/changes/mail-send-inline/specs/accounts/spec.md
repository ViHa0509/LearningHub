## MODIFIED Requirements

### Requirement: Invite only
After the admin exists, an account SHALL be created only from a valid invitation: a single-use link sent to the invited email, valid 7 days. The invitation email MUST be sent before the invitation request is answered, so the answer reports whether the mail server accepted the message. The invited person MUST sign up with that email (password), or with GitHub or Google whose verified email equals it. Any other sign-up or GitHub or Google sign-in MUST be refused with "You need an invitation to join" and create no account and no session.

#### Scenario: Invited by email
- **GIVEN** the admin invited `ana@example.test`
- **WHEN** Ana opens the invitation link and sets a password
- **THEN** a member account for `ana@example.test` is created, signed in, and the invitation cannot be used again

#### Scenario: Invited, signs in with GitHub
- **GIVEN** an invitation for `ana@example.test`
- **WHEN** a GitHub account whose verified email is `ana@example.test` signs in
- **THEN** a member account is created and linked to that GitHub identity

#### Scenario: Not invited
- **WHEN** someone without an invitation signs up or signs in with GitHub or Google
- **THEN** it is refused with "You need an invitation to join" and no account is created

#### Scenario: Expired or revoked invitation
- **WHEN** an invitation link older than 7 days, revoked, or already used is opened
- **THEN** it is refused and no account is created

#### Scenario: Mail sent before the answer
- **GIVEN** no SMTP server is configured (outbox mode)
- **WHEN** the admin invites `ana@example.test`
- **THEN** the invitation email is already in the outbox folder when the answer arrives

#### Scenario: Mail server refuses the invitation email
- **GIVEN** SMTP is configured and the mail server closes the connection
- **WHEN** the admin invites `ana@example.test`
- **THEN** the invitation is created and listed as pending, the answer is 502 with "The invitation was created but the email could not be sent (SMTPServerDisconnected)", and the server log holds the purpose and the exception class but no address, link or token

### Requirement: Users page
The admin SHALL have Settings -> Users listing users (email, name, role, created, last seen, disabled) and pending invitations, and SHALL be able to invite an email, revoke an invitation, disable or enable a member (disabling ends their sessions and blocks sign-in), and delete a member after typing their email (removing the member, their sessions and all their data). When the invitation email could not be sent, the page MUST show the server's message as an error instead of "Invitation sent" and MUST still list the invitation as pending. Members MUST get 403 from these routes and MUST NOT see the page.

#### Scenario: Disable a member
- **GIVEN** a member signed in on another browser
- **WHEN** the admin disables the member
- **THEN** the member's next request is answered 401 and signing in again is refused

#### Scenario: Delete a member
- **WHEN** the admin deletes a member after typing their email
- **THEN** the member's account, notes, lessons and providers are gone and other users' data is unchanged

#### Scenario: Members cannot manage users
- **WHEN** a member calls the users or invitations routes
- **THEN** the answer is 403

#### Scenario: Invitation email could not be sent
- **GIVEN** the invitation route answers 502 with "The invitation was created but the email could not be sent (SMTPServerDisconnected)"
- **WHEN** the admin sends an invitation from Settings -> Users
- **THEN** that text is shown as an error, "Invitation sent" is not shown, and the email appears under Pending invitations
