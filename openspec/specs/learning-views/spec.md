# learning-views Specification

## Purpose
Gives the user two connected views of what they have learned - a list on the left and a roadmap map in the center - plus a reserved place on the right for the future agent.

## Requirements

### Requirement: Three-pane layout
The web app SHALL show a left panel with the learned-items list, a center panel with the roadmap map, and a right panel reserved for the agent. The left and right panels MUST be collapsible, and the center panel takes the remaining width.

#### Scenario: App opens
- **WHEN** the user opens the app
- **THEN** the three panels are visible and the right panel states that the agent is not available yet

#### Scenario: Collapse a side panel
- **WHEN** the user collapses the left panel
- **THEN** the map widens to use the freed space, and the panel can be expanded again

### Requirement: Learned-items list
The left panel SHALL list all notes grouped by domain, then by node in roadmap order, with an "Unsorted" group for notes without a valid link. It MUST offer a text filter on note titles.

#### Scenario: Grouped list
- **GIVEN** notes linked to `backend/caching`, `devops/ci-cd`, and one unsorted note
- **WHEN** the user looks at the left panel
- **THEN** the notes appear under Backend > Caching, DevOps > CI/CD and Unsorted

#### Scenario: Filter by title
- **WHEN** the user types `redis` in the filter
- **THEN** only notes whose title contains `redis` (case-insensitive) remain visible

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
Selecting a note in the list SHALL show its domain on the map and highlight its node. Selecting a node on the map SHALL highlight that node's notes in the list.

#### Scenario: From list to map
- **WHEN** the user selects a note linked to `devops/ci-cd` while the Backend map is shown
- **THEN** the map switches to DevOps and highlights the CI/CD node

#### Scenario: From map to list
- **WHEN** the user selects the Caching node on the Backend map
- **THEN** the list highlights the notes linked to `backend/caching`

### Requirement: Import from the UI
The web app SHALL let the user pick or drop one or more HTML files to import, show the outcome per file, and then offer to link each new note to a node, which the user may skip.

#### Scenario: Import and link
- **WHEN** the user drops `redis-eviction.html` and picks `backend/caching` for it
- **THEN** the note appears in the list under Backend > Caching and the Caching node count goes up by one

#### Scenario: Skip linking
- **WHEN** the user imports a file and skips choosing a node
- **THEN** the note appears under Unsorted

### Requirement: Read a note
Opening a note SHALL show its title, the original page in an isolated frame, and controls to rename it, change or remove its link, and delete it after a confirmation.

#### Scenario: Open a note
- **WHEN** the user opens a note from the list or from a node
- **THEN** the original page is shown with the note's title and link controls

#### Scenario: Delete needs confirmation
- **WHEN** the user chooses delete on a note
- **THEN** the app asks for confirmation and deletes the note only after the user confirms

### Requirement: Empty state
When there are no notes, the app SHALL explain how to import the first file instead of showing an empty list.

#### Scenario: First start
- **WHEN** the user opens the app with no notes
- **THEN** the left panel shows a short explanation and an import button
