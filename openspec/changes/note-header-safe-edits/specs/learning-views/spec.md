## MODIFIED Requirements

### Requirement: Read a note
Clicking a note in the learned list, in the Archived section, or in a lesson page, SHALL open it directly without a separate open button. The note page shows its title as a heading, the original page in an isolated frame, and controls to rename it, edit its page, change or remove its link, archive or restore it, and delete it after a confirmation. Renaming MUST be an explicit action (a Rename button or the Rename item of More actions) that opens the title field with Save and Cancel; the title is never editable otherwise and never saved on blur. The link control MUST be labelled "Linked to", and a changed link MUST be saved only through a Save button (with Cancel), never on change, blur or leaving. After a rename or a saved link change, the page MUST offer Undo for a few seconds, which puts the previous title or link back. When the note is linked to an existing node, the page MUST offer an "Open lesson" link to that node's lesson page. An archived note's page MUST say that the note is archived.

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

#### Scenario: Undo a link change
- **GIVEN** the user linked an unsorted note to `o-to-hang-b/chuong-1` with Save link
- **WHEN** the user clicks Undo on the status line
- **THEN** the note is unsorted again

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
