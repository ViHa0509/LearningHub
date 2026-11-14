# Spec Delta

## MODIFIED Requirements

### Requirement: Learned-items list
The left panel SHALL list all notes that are not archived, grouped by domain, then by node, with an "Unsorted" group for notes without a valid link. Notes in a group are ordered by their last update, newest first; nodes and domains are ordered by their most recently updated note; Unsorted is last. A note the agent saved shows an "agent" badge. It MUST offer a title filter. Each item MUST offer a "More actions" menu with Rename, Move to node and Archive, without changing what a click on the item does; Rename MUST show Save and Cancel. A collapsed "Archived" section below the groups SHALL show the archived count and, when expanded, list them with Restore and Delete.

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

#### Scenario: Newest first
- **GIVEN** in Backend, a note on `backend/caching` updated yesterday and a note on `backend/apis` updated today
- **WHEN** the user looks at the left panel
- **THEN** Backend > APIs comes before Backend > Caching, and in each group the most recently updated note is first
