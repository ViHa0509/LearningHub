## MODIFIED Requirements

### Requirement: Read a note
Clicking a note in the learned list, the Archived section or a lesson page SHALL open it directly. The note page shows its title as a heading, the original page in an isolated frame, and a More actions menu (Rename, Edit page, Export PDF, Archive or Restore, Delete). A rename or a changed "Linked to" link MUST be saved only with Save, never on blur or leaving, and MUST offer Undo for a few seconds. A linked note offers "Open lesson"; an archived note's page says it is archived.

#### Scenario: Open a note
- **WHEN** the user clicks a note title in the list
- **THEN** the original page is shown with the note's title and link controls, and the list has no separate "Open" button

#### Scenario: Rename on the note page
- **WHEN** the user chooses Rename, changes the title field and clicks Save
- **THEN** the title is stored; Escape or Cancel closes the field without a change, and leaving the field without saving does not change it

#### Scenario: The title is not a text field
- **WHEN** the user opens a note
- **THEN** the title is shown as a heading and no title field is shown until Rename is chosen

#### Scenario: Undo a rename
- **GIVEN** the user renamed "Agentic Engineer" to "chuong 1"
- **WHEN** the user clicks Undo on the status line
- **THEN** the note is titled "Agentic Engineer" again

#### Scenario: Change the link with Save
- **GIVEN** a note linked to `backend/redis`
- **WHEN** the user picks `devops/docker` in "Linked to"
- **THEN** nothing is saved, and Save link and Cancel link change appear
- **WHEN** the user clicks Save link
- **THEN** the note is linked to `devops/docker` and the buttons disappear

#### Scenario: Cancel a link change
- **GIVEN** a note linked to `backend/redis` and `devops/docker` picked but not saved
- **WHEN** the user clicks Cancel link change, or leaves the page
- **THEN** the note stays linked to `backend/redis` and the picker shows it again

#### Scenario: Undo a link change
- **GIVEN** the user linked an unsorted note to `o-to-hang-b/chuong-1` with Save link
- **WHEN** the user clicks Undo on the status line
- **THEN** the note is unsorted again

#### Scenario: Open the lesson of the linked node
- **GIVEN** a note linked to `backend/redis`
- **WHEN** the user clicks Open lesson
- **THEN** the lesson page of `backend/redis` opens

#### Scenario: No lesson link without a node
- **GIVEN** an unsorted note, or a note whose node no longer exists
- **THEN** the page shows no Open lesson link

#### Scenario: Delete needs confirmation
- **WHEN** the user chooses delete on a note
- **THEN** the app asks for confirmation and deletes the note only after the user confirms

#### Scenario: Archived note page
- **WHEN** the user opens an archived note
- **THEN** the page says the note is archived and offers Restore, and restoring it puts it back in the list

#### Scenario: More actions menu
- **GIVEN** a note that is not archived
- **WHEN** the user presses More actions in the note header
- **THEN** a menu opens with Rename, Edit page, Export PDF, Archive and Delete, and the header shows none of them as a separate button

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
- **THEN** the menu offers only Rename, Archive or Restore, and Delete
