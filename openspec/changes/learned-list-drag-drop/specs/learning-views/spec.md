## MODIFIED Requirements

### Requirement: Learned-items list
The left panel SHALL list all notes that are not archived, grouped by domain, then by node in roadmap order, with an "Unsorted" group for notes without a valid link. It MUST offer a title filter. Each item MUST offer a "More actions" menu with Rename, Move to node and Archive, without changing what a click on the item does; Rename MUST show Save and Cancel. A note of the list MUST be draggable with the mouse onto a topic of the list or onto Unsorted, and the drop links the note to that topic or removes its link. While a note is dragged, every domain shown in the list MUST also show its topics that have no note, and the Unsorted group MUST be shown even when it is empty; they are hidden again when the drag ends. After a drop the list MUST offer Undo for a few seconds, which puts the previous link back. A collapsed "Archived" section below the groups SHALL show the archived count and, when expanded, list them with Restore and Delete.

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

#### Scenario: Topics without notes appear while dragging
- **GIVEN** a note under Backend > Caching and no note under Backend > Redis
- **WHEN** the user starts dragging a note of the list
- **THEN** Backend also lists Redis and its other topics without notes after Caching, Unsorted is shown, and a domain that has no note is not added
- **AND** when the drag ends without a drop, those topics are hidden again and no link changed

#### Scenario: Drop a note on a topic
- **GIVEN** a note under Backend > Caching
- **WHEN** the user drags it onto Redis in the list and drops it
- **THEN** the note appears under Backend > Redis, and the list says the note was moved to Redis with an Undo button

#### Scenario: Undo a drop
- **GIVEN** a note was just dropped from Backend > Caching onto Redis
- **WHEN** the user clicks Undo
- **THEN** the note is under Backend > Caching again

#### Scenario: Drop on Unsorted
- **WHEN** the user drags a linked note onto Unsorted and drops it
- **THEN** the note has no link and appears under Unsorted

#### Scenario: Drop on the note's own topic
- **WHEN** the user drops a note on the topic it is already under
- **THEN** nothing is saved and no Undo line appears

#### Scenario: Archive from the list
- **WHEN** the user chooses Archive in a note's menu
- **THEN** the note leaves its group, the Archived section count goes up by one, and the note is listed there when the section is expanded

#### Scenario: Restore from the Archived section
- **WHEN** the user chooses Restore on an archived note
- **THEN** the note is back in its group and the Archived count goes down by one

#### Scenario: Delete from the Archived section needs confirmation
- **WHEN** the user chooses Delete on an archived note
- **THEN** the app asks for confirmation and deletes the note only after the user confirms
