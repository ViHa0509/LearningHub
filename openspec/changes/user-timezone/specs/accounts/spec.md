## ADDED Requirements

### Requirement: Each user chooses a time zone
The system SHALL keep a time zone per user. A signed-in user without one is asked for it in a dialog that proposes the browser's time zone, with Save and "Not now"; nothing is saved without Save. The user can change it later in Settings -> Account. Only valid IANA time zone names are accepted, and a user changes only their own. Setting it needs the app header.

#### Scenario: Asked after sign-in
- **GIVEN** a member who has no time zone
- **WHEN** the member signs in
- **THEN** a dialog proposes the browser's time zone, and Save stores it

#### Scenario: Not now
- **WHEN** the member chooses "Not now" or presses Escape
- **THEN** nothing is stored, the dialog does not return while the member stays signed in, and it is shown again after the next sign-in

#### Scenario: Not asked again
- **GIVEN** a member who saved a time zone
- **WHEN** the member signs in again
- **THEN** no dialog is shown

#### Scenario: Change in Settings
- **WHEN** the member picks another time zone in Settings -> Account and saves
- **THEN** it is stored and still shown after a reload

#### Scenario: Unknown name
- **WHEN** a client sends a time zone name that does not exist
- **THEN** the system refuses it and nothing changes

#### Scenario: Missing header
- **WHEN** a client sets the time zone without the app header
- **THEN** the system answers forbidden and nothing changes

### Requirement: Times are shown in the user's time zone
Every time the app shows SHALL be in the signed-in user's time zone, or in the browser's time zone while the user has none. What the server stores and counts stays in UTC.

#### Scenario: Chosen zone
- **GIVEN** a user with the time zone `Asia/Ho_Chi_Minh` on a browser set to UTC
- **WHEN** the user opens the chat history of a conversation saved at 23:30 UTC
- **THEN** its time is shown as 06:30 on the next day

#### Scenario: No zone yet
- **GIVEN** a user without a time zone
- **WHEN** the user opens the chat history
- **THEN** times are shown in the browser's time zone
