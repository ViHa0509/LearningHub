## ADDED Requirements

### Requirement: Settings with vertical tabs
Settings SHALL show vertical tabs Profile, Security, AI Providers, Preferences and Data & Privacy, each with its own address under `#/settings/`. `#/settings` opens AI Providers, and the existing provider page addresses keep working. On narrow screens the tabs become a select at the top.

#### Scenario: Open a tab by address
- **WHEN** the user opens `#/settings/security`
- **THEN** the Security tab is selected and its content is shown

### Requirement: Profile
The Profile tab SHALL let the Owner change avatar (PNG, JPEG or WebP up to 1 MB), display name and bio with Save, change the email (which sends a verification link and shows the email as unverified until confirmed), change the password, and delete the account after typing DELETE. Deleting the account removes the account and its sessions but keeps notes and lessons.

#### Scenario: Change display name
- **WHEN** the Owner edits the display name and clicks Save
- **THEN** the avatar menu shows the new name, and leaving without Save keeps the old one

#### Scenario: Wrong avatar file
- **WHEN** the Owner uploads a 3 MB image or a PDF as avatar
- **THEN** it is refused with the reason

### Requirement: Security
The Security tab SHALL list linked sign-in methods with Link and Unlink, never allowing the last method to be removed, and list active sessions (device, address, last seen, current) with Revoke and Log out everywhere else.

#### Scenario: Last method
- **GIVEN** GitHub is the only sign-in method
- **WHEN** the Owner tries to unlink it
- **THEN** it is refused with a message to add another method first

### Requirement: Preferences
The Preferences tab SHALL set the theme, the agent's answer language (Auto, English or Vietnamese) and the default effort for new chats, saved to the account with Save, and the chat and agent MUST use them.

#### Scenario: Answer language
- **GIVEN** the answer language is Vietnamese
- **WHEN** the user asks a question in English
- **THEN** the agent's instructions ask it to answer in Vietnamese

### Requirement: Data & Privacy
The Data & Privacy tab SHALL export the user's data as a .zip (notes with their original pages, lessons, roadmap links, provider configurations without keys) and delete all notes after the user types DELETE.

#### Scenario: Export has no keys
- **WHEN** the Owner exports their data
- **THEN** the archive holds notes, lessons and provider configurations, and no API key or token appears in it
