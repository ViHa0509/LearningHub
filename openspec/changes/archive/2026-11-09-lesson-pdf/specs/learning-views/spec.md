## ADDED Requirements

### Requirement: Export a note as PDF
The note page SHALL offer Export PDF, which opens the note's page in a new tab and starts the browser's print dialog there, so the user can save it as PDF. The page in that tab MUST stay isolated from the app as on the note page (opaque origin, no access to the app's data); only the print dialog is allowed in addition.

#### Scenario: Export a note
- **WHEN** the user clicks Export PDF on a note
- **THEN** a new tab opens the note's print view, which runs in an isolated origin and asks the browser to print

#### Scenario: Print view stays isolated
- **WHEN** the print view of a note whose page runs JavaScript is opened
- **THEN** its scripts cannot read the app's storage or call the app's API as the user
