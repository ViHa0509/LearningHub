# Spec Delta

## MODIFIED Requirements

### Requirement: Users page
The admin SHALL have Settings -> Users listing users (email, name, role, created, last seen, disabled) and pending invitations, and SHALL be able to invite an email, revoke an invitation, disable or enable a member (disabling ends their sessions and blocks sign-in), and delete a member after typing their email (removing the member, their sessions and all their data). A member's row SHALL carry one "More actions" menu button holding Enable or Disable and, last and marked as dangerous, Delete; the admin's own row shows "You" and no menu. Members MUST get 403 from these routes and MUST NOT see the page.

#### Scenario: Row actions menu
- **GIVEN** the admin opens Settings -> Users with a member `vi@example.test`
- **WHEN** the admin opens the member's More actions menu
- **THEN** it offers Disable and Delete, the admin's own row offers no menu, and choosing Disable asks for confirmation as before

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
