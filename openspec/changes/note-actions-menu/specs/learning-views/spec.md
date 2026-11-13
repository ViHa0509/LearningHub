# Spec Delta

## MODIFIED Requirements

### Requirement: Read a note
Clicking a note in the learned list, in the Archived section, or in a lesson page, SHALL open it directly without a separate open button. The note page shows its title, the original page in an isolated frame, and controls to rename it (with Save and Cancel, never saved on blur), edit its page, change or remove its link, archive or restore it, and delete it after a confirmation. Edit page, Export PDF, Archive or Restore, and Delete MUST be offered in one More actions menu in the note header instead of as separate buttons; the menu works with the keyboard and closes with Escape or a click outside it. An archived note's page MUST say that the note is archived.

#### Scenario: Open a note
- **WHEN** the user clicks a note title in the list
- **THEN** the original page is shown with the note's title and link controls, and the list has no separate "Open" button

#### Scenario: Rename on the note page
- **WHEN** the user changes the title field
- **THEN** Save and Cancel appear, Save stores the title, and leaving the field without saving does not change it

#### Scenario: Delete needs confirmation
- **WHEN** the user chooses delete on a note
- **THEN** the app asks for confirmation and deletes the note only after the user confirms

#### Scenario: Archived note page
- **WHEN** the user opens an archived note
- **THEN** the page says the note is archived and offers Restore, and restoring it puts it back in the list

#### Scenario: More actions menu
- **GIVEN** a note that is not archived
- **WHEN** the user presses More actions in the note header
- **THEN** a menu opens with Edit page, Export PDF, Archive and Delete, and the header shows none of them as a separate button

#### Scenario: Menu with the keyboard
- **GIVEN** the More actions menu is open
- **WHEN** the user presses Down and then Escape
- **THEN** the focus moves to the next item, then the menu closes and the focus is back on the More actions button

#### Scenario: Choosing an action closes the menu
- **WHEN** the user chooses Archive in the menu
- **THEN** the menu closes, the page says the note is archived, and the menu now offers Restore instead of Archive

#### Scenario: Menu while editing the page
- **GIVEN** the page editor is open
- **WHEN** the user opens More actions
- **THEN** the menu offers only Archive or Restore, and Delete
