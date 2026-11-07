## MODIFIED Requirements

### Requirement: Learned-items list
The left panel SHALL list all notes that are not archived, grouped by domain, then by node in roadmap order, with an "Unsorted" group for notes without a valid link. It MUST offer a text filter on note titles. Each item MUST offer a "More actions" menu with Rename, Move to node and Archive, without changing what a click on the item does. Below the groups, a collapsed "Archived" section SHALL show the number of archived notes and, when expanded, list them with Restore and Delete.

#### Scenario: Grouped list
- **GIVEN** notes linked to `backend/caching`, `devops/ci-cd`, and one unsorted note
- **WHEN** the user looks at the left panel
- **THEN** the notes appear under Backend > Caching, DevOps > CI/CD and Unsorted

#### Scenario: Filter by title
- **WHEN** the user types `redis` in the filter
- **THEN** only notes whose title contains `redis` (case-insensitive) remain visible

#### Scenario: Rename from the list
- **WHEN** the user chooses Rename in a note's menu, types `Redis TTL` and presses Enter
- **THEN** the item shows `Redis TTL`, and pressing Escape instead leaves the title unchanged

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
Clicking a note in the learned list, in the Archived section, or in a lesson page, SHALL open it directly without a separate open button. The note page shows its title, the original page in an isolated frame, and controls to rename it, change or remove its link, archive or restore it, and delete it after a confirmation. An archived note's page MUST say that the note is archived.

#### Scenario: Open a note
- **WHEN** the user clicks a note title in the list
- **THEN** the original page is shown with the note's title and link controls, and the list has no separate "Open" button

#### Scenario: Delete needs confirmation
- **WHEN** the user chooses delete on a note
- **THEN** the app asks for confirmation and deletes the note only after the user confirms

#### Scenario: Archived note page
- **WHEN** the user opens an archived note
- **THEN** the page says the note is archived and offers Restore, and restoring it puts it back in the list
