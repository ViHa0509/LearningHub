## MODIFIED Requirements

### Requirement: Three-pane layout
The web app SHALL show a top bar with the app title and the theme switch, and below it a left panel with the learned-items list, a center panel with the current page (home, roadmap map, lesson or note), and a right panel for the agent. The left and right panels MUST be collapsible, and the center panel takes the remaining width.

#### Scenario: App opens
- **WHEN** the user opens the app
- **THEN** the top bar, the three panels and the home page in the center are visible

#### Scenario: Collapse a side panel
- **WHEN** the user collapses the left panel
- **THEN** the center widens to use the freed space, and the panel can be expanded again

### Requirement: Two-way selection between list and map
Opening a note from the list SHALL also select its node, so that the map of its domain, when shown, highlights that node. Opening a node's lesson page from the map SHALL highlight that node's notes in the list.

#### Scenario: From list to map
- **WHEN** the user opens a note linked to `devops/ci-cd` from the list and then goes to the DevOps map
- **THEN** the map highlights the CI/CD node

#### Scenario: From map to list
- **WHEN** the user clicks the Caching node on the Backend map
- **THEN** the Caching lesson page opens and the list highlights the notes linked to `backend/caching`

### Requirement: Read a note
Clicking a note in the learned list, or in a lesson page, SHALL open it directly without a separate open button. The note page shows its title, the original page in an isolated frame, and controls to rename it, change or remove its link, and delete it after a confirmation.

#### Scenario: Open a note
- **WHEN** the user clicks a note title in the list
- **THEN** the original page is shown with the note's title and link controls, and the list has no separate "Open" button

#### Scenario: Delete needs confirmation
- **WHEN** the user chooses delete on a note
- **THEN** the app asks for confirmation and deletes the note only after the user confirms

## ADDED Requirements

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
