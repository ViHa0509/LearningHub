## MODIFIED Requirements

### Requirement: Edit a note's page
The note page SHALL offer Edit page, which makes the text of the rendered page editable in place: the user clicks a line on the page and types, without seeing HTML. Only the text the user changed is saved. The editor MUST have a Save button, disabled until something changes, and Cancel; Ctrl+S also saves. Cancel or leaving the note with unsaved changes MUST ask for confirmation first.

#### Scenario: Edit and save
- **WHEN** the user clicks Edit page, clicks a paragraph on the page, changes its text and clicks Save
- **THEN** the editing ends and the note page shows the changed paragraph, with the rest of the page as before

#### Scenario: Cancel with unsaved changes
- **WHEN** the user changes some text and clicks Cancel
- **THEN** the app asks to discard the changes, and the page keeps its old content after the user confirms

#### Scenario: Preview stays isolated
- **WHEN** the page being edited runs JavaScript
- **THEN** it runs in a sandboxed frame without access to the application
