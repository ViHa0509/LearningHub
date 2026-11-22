## MODIFIED Requirements

### Requirement: Open sign-up and invitations
After the admin exists, anyone SHALL be able to create a member account, with an email and a password on the Sign up page or with GitHub or Google whose verified email has no account yet; the new account is signed in at once. An email that already has an account MUST be refused, and the email of an account that is not verified MUST NOT be linked to a GitHub or Google identity. Invitations still create verified members. The invitation email MUST be sent before the invitation request is answered, so the answer reports whether the mail server accepted the message.

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
