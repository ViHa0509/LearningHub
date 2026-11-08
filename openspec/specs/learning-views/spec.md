# learning-views Specification

## Purpose
Gives the user connected views of what they have learned - a list on the left, the current page (home, roadmap map, lesson or note) in the center and the agent on the right - with a theme switch and an address per page.

## Requirements

### Requirement: Three-pane layout
The web app SHALL show a top bar with the app title and the theme switch, and below it a left panel with the learned-items list, a center panel with the current page (home, roadmap map, lesson or note), and a right panel with the agent chat. The left and right panels MUST be collapsible, and the center panel takes the remaining width.

#### Scenario: App opens
- **WHEN** the user opens the app
- **THEN** the top bar, the three panels, the home page in the center and the agent chat on the right are visible

#### Scenario: Collapse a side panel
- **WHEN** the user collapses the left panel
- **THEN** the center widens to use the freed space, and the panel can be expanded again

### Requirement: Learned-items list
The left panel SHALL list all notes that are not archived, grouped by domain, then by node in roadmap order, with an "Unsorted" group for notes without a valid link. It MUST offer a title filter. Each item MUST offer a "More actions" menu with Rename, Move to node and Archive, without changing what a click on the item does; Rename MUST show Save and Cancel. A collapsed "Archived" section below the groups SHALL show the archived count and, when expanded, list them with Restore and Delete.

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

### Requirement: Roadmap map with note markers
The center panel SHALL draw the roadmap of the selected domain as a graph of nodes and parent-child edges, mark every node that has notes with its note count, and let the user switch domains.

#### Scenario: Marked nodes
- **GIVEN** two notes are linked to `backend/caching`
- **WHEN** the Backend map is shown
- **THEN** the Caching node is visibly marked with the count 2, and nodes without notes are not marked

#### Scenario: Switch domain
- **WHEN** the user selects the DevOps domain
- **THEN** the map shows the DevOps roadmap

### Requirement: Two-way selection between list and map
Opening a note from the list SHALL also select its node, so that the map of its domain, when shown, highlights that node. Opening a node's lesson page from the map SHALL highlight that node's notes in the list.

#### Scenario: From list to map
- **WHEN** the user opens a note linked to `devops/ci-cd` from the list and then goes to the DevOps map
- **THEN** the map highlights the CI/CD node

#### Scenario: From map to list
- **WHEN** the user clicks the Caching node on the Backend map
- **THEN** the Caching lesson page opens and the list highlights the notes linked to `backend/caching`

### Requirement: Import from the UI
The web app SHALL let the user pick or drop one or more HTML files to import, show the outcome per file, and then offer to link each new note to a node, which the user may skip.

#### Scenario: Import and link
- **WHEN** the user drops `redis-eviction.html` and picks `backend/caching` for it
- **THEN** the note appears in the list under Backend > Caching and the Caching node count goes up by one

#### Scenario: Skip linking
- **WHEN** the user imports a file and skips choosing a node
- **THEN** the note appears under Unsorted

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

### Requirement: Empty state
When there are no notes, the app SHALL explain how to import the first file instead of showing an empty list.

#### Scenario: First start
- **WHEN** the user opens the app with no notes
- **THEN** the left panel shows a short explanation and an import button

### Requirement: Light and dark theme
The app SHALL offer three theme choices - system, light and dark - from the top bar. The choice MUST apply immediately and be remembered by the browser; "system" follows the operating system setting.

#### Scenario: Switch to dark
- **GIVEN** the operating system uses a light theme
- **WHEN** the user chooses dark
- **THEN** the app turns dark at once, and stays dark after a reload

#### Scenario: Back to system
- **WHEN** the user chooses system
- **THEN** the app follows the operating system theme again

### Requirement: Pages are addressable
Each page SHALL have its own address in the URL hash - home `#/`, roadmap `#/roadmap/<domain>`, lesson `#/lesson/<domain>/<node>`, note `#/note/<id>` - so that the browser back button returns to the previous page and an address opens its page directly.

#### Scenario: Back button
- **WHEN** the user goes from home to the Backend map to the Caching lesson and presses the browser back button
- **THEN** the Backend map is shown again

#### Scenario: Open by address
- **WHEN** the user loads the app at `#/lesson/backend/caching`
- **THEN** the Caching lesson page is shown

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
