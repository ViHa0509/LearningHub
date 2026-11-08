## MODIFIED Requirements

### Requirement: Learned-items list
The left panel SHALL list all notes that are not archived, grouped by domain, then by node in roadmap order, with an "Unsorted" group for notes without a valid link. It MUST offer a text filter on note titles. Each item MUST offer a "More actions" menu with Rename, Move to node and Archive, without changing what a click on the item does. Rename MUST show Save and Cancel buttons. Below the groups, a collapsed "Archived" section SHALL show the number of archived notes and, when expanded, list them with Restore and Delete.

#### Scenario: Grouped list
- **GIVEN** notes linked to `backend/caching`, `devops/ci-cd`, and one unsorted note
- **WHEN** the user looks at the left panel
- **THEN** the notes appear under Backend > Caching, DevOps > CI/CD and Unsorted

#### Scenario: Filter by title
- **WHEN** the user types `redis` in the filter
- **THEN** only notes whose title contains `redis` (case-insensitive) remain visible

#### Scenario: Rename from the list
- **WHEN** the user chooses Rename in a note's menu, types `Redis TTL` and clicks Save (or presses Enter)
- **THEN** the item shows `Redis TTL`, and clicking Cancel or pressing Escape instead leaves the title unchanged

#### Scenario: Rename Save needs a change
- **WHEN** the rename field is empty or still holds the current title
- **THEN** its Save button is disabled

#### Scenario: Move from the list
- **WHEN** the user chooses Move to node in the menu of a note under Unsorted and picks `backend/redis`
- **THEN** the note appears under Backend > Redis

#### Scenario: Archive from the list
- **WHEN** the user chooses Archive in a note's menu
- **THEN** the note leaves its group, the Archived section count goes up by one, and the note is listed there when the section is expanded

#### Scenario: Restore from the Archived section
- **WHEN** the user chooses Restore on an archived note
- **THEN** the note is back in its group and the Archived count goes down by one

#### Scenario: Delete from the Archived section needs confirmation
- **WHEN** the user chooses Delete on an archived note
- **THEN** the app asks for confirmation and deletes the note only after the user confirms

### Requirement: Read a note
Clicking a note in the learned list, in the Archived section, or in a lesson page, SHALL open it directly without a separate open button. The note page shows its title, the original page in an isolated frame, and controls to rename it (with Save and Cancel, never saved on blur), edit its page, change or remove its link, archive or restore it, and delete it after a confirmation. An archived note's page MUST say that the note is archived.

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

## ADDED Requirements

### Requirement: Edit a note's page
The note page SHALL offer Edit page, which shows the page's HTML source in an editor next to a live preview in an isolated frame. The editor MUST have a Save button, disabled until the source changes, and Cancel. Ctrl+S also saves. Cancel or leaving the note with unsaved changes MUST ask for confirmation first.

#### Scenario: Edit and save
- **WHEN** the user clicks Edit page, changes the source and clicks Save
- **THEN** the editor closes and the note page shows the new content

#### Scenario: Cancel with unsaved changes
- **WHEN** the user changes the source and clicks Cancel
- **THEN** the app asks to discard the changes, and the page keeps its old content after the user confirms

#### Scenario: Preview stays isolated
- **WHEN** the edited source runs JavaScript
- **THEN** the preview runs it in a sandboxed frame without access to the application
