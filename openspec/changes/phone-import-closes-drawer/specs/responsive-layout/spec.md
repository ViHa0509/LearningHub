## ADDED Requirements

### Requirement: Import from the list drawer
On a phone, an action in the learned-list drawer that opens the import dialog SHALL close the drawer, so the dialog is shown over the page alone. Closing the dialog MUST NOT reopen the drawer. On a tablet and a desktop the learned list stays open behind the dialog.

#### Scenario: Import from the drawer on a phone
- **GIVEN** the learned list drawer is open on a phone
- **WHEN** the user taps Import
- **THEN** the drawer closes and the import dialog is shown

#### Scenario: Import from an empty list on a phone
- **GIVEN** a phone, a user with no notes, and the learned list drawer open
- **WHEN** the user taps "Import HTML or PDF files"
- **THEN** the drawer closes and the import dialog is shown

#### Scenario: Cancel the import on a phone
- **GIVEN** the import dialog opened from the drawer on a phone
- **WHEN** the user cancels the dialog
- **THEN** the dialog closes and the drawer stays closed

#### Scenario: Import on a desktop
- **GIVEN** the app at least 1100 px wide with the learned list open
- **WHEN** the user clicks Import
- **THEN** the import dialog is shown and the learned list is still open
