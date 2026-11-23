## Purpose

The personal parts of Settings: the user's profile, sign-in security, agent preferences, leaving the app, and removing all of their notes.

## ADDED Requirements

### Requirement: Settings tabs
Settings SHALL show Profile, Security and Preferences tabs next to the existing ones, each with its own address under `#/settings/`. `#/settings/account` MUST open Profile.

#### Scenario: Open a tab by address
- **WHEN** the user opens `#/settings/security`
- **THEN** the Security tab is selected and its content is shown

#### Scenario: Old account address
- **WHEN** the user opens `#/settings/account`
- **THEN** the Profile tab is shown

### Requirement: Profile details
The Profile tab SHALL let every user change their display name (1 to 80 characters) and bio (up to 500 characters) with Save and Cancel.

#### Scenario: Change display name
- **WHEN** the user edits the display name and clicks Save
- **THEN** the avatar menu shows the new name

#### Scenario: Leave without saving
- **WHEN** the user edits the bio and leaves the tab
- **THEN** the app asks before discarding, and the stored bio is unchanged

### Requirement: Avatar
The user SHALL be able to upload a PNG, JPEG or WebP avatar up to 1 MB, checked by the file's content. Other files MUST be refused with the reason. The avatar MUST be served only to signed-in users, with an image content type and `X-Content-Type-Options: nosniff`. Remove MUST go back to initials.

#### Scenario: Upload an avatar
- **WHEN** the user uploads a 200 KB PNG
- **THEN** the avatar menu shows it

#### Scenario: Wrong avatar file
- **WHEN** the user uploads a 3 MB image, a PDF, an SVG, or an HTML file renamed to `.png`
- **THEN** it is refused with the reason, and the avatar is unchanged

### Requirement: Email change
The user SHALL be able to request an email change. A single-use verification link valid 24 hours MUST go to the new address and a notice to the old one. The email MUST change only when the link is opened. An address already used by another account MUST be refused when the link is opened, without saying so at request time.

#### Scenario: Change confirmed
- **WHEN** the user requests a change to a new address and opens the link from that address
- **THEN** the account's email is the new address, marked verified, and the old address got a notice

#### Scenario: Not confirmed
- **WHEN** the user requests a change and does not open the link
- **THEN** the account keeps the old email, and sign-in with the old email still works

### Requirement: Password in Security
The Security tab SHALL let the user change their password by giving the current one, or set a password when the account has none. A new password follows the auth password rules.

#### Scenario: Change password
- **WHEN** the user gives the right current password and a valid new one
- **THEN** the new password works at the next sign-in and the old one does not

### Requirement: Linked sign-in methods
The Security tab SHALL list the sign-in methods of the account (password, GitHub, Google). The user SHALL be able to link GitHub or Google while signed in, and to unlink a method. The last method MUST NOT be removable. An identity already linked to another account MUST be refused.

#### Scenario: Last method
- **GIVEN** GitHub is the only sign-in method
- **WHEN** the user tries to unlink it
- **THEN** it is refused with a message to add another method first

#### Scenario: Link GitHub
- **GIVEN** the account has only a password
- **WHEN** the user links GitHub and completes the provider's sign-in
- **THEN** GitHub is listed, and signing in with GitHub opens the same account

#### Scenario: Identity of another account
- **WHEN** the user links a GitHub identity that another account already uses
- **THEN** it is refused and neither account changes

### Requirement: Sessions in Security
The Security tab SHALL list the user's active sessions (device, address, last seen, which is current) with Revoke and Log out everywhere else.

#### Scenario: Revoke another session
- **WHEN** the user revokes a session that is not the current one
- **THEN** that session is signed out and disappears from the list

### Requirement: Preferences
The Preferences tab SHALL set the agent's answer language (Auto, English or Vietnamese) and the default effort for new chats, saved to the account with Save. With English or Vietnamese, the agent's instructions MUST ask it to answer in that language; with Auto, in the language the user writes in.

#### Scenario: Answer language
- **GIVEN** the answer language is Vietnamese
- **WHEN** the user asks a question in English
- **THEN** the agent's instructions ask it to answer in Vietnamese

#### Scenario: Default effort
- **GIVEN** the default effort is High
- **WHEN** the user starts a new chat on another device
- **THEN** the effort picker shows High

### Requirement: Delete account
A member SHALL be able to delete their own account from Profile after typing their email. It MUST remove the account, its sessions and all of its data, as an admin's delete of that member does, and sign the browser out. The admin MUST NOT be able to delete their own account.

#### Scenario: Member deletes their account
- **WHEN** a member types their email and confirms
- **THEN** they are signed out, cannot sign in again, and none of their notes, lessons, providers or chats remain

#### Scenario: Admin cannot
- **WHEN** the admin opens Profile
- **THEN** Delete account is not offered, and the route refuses the admin

### Requirement: Delete all notes
Data & sync SHALL offer Delete all notes after the user types DELETE. It MUST remove only the signed-in user's notes and their links; lessons stay; a stored file MUST be deleted only when no note of any user refers to it.

#### Scenario: Delete all notes
- **GIVEN** users A and B imported the same file
- **WHEN** A deletes all notes
- **THEN** A has no notes, A's lessons are unchanged, and B's note still opens
