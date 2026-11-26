## MODIFIED Requirements

### Requirement: Learned-items list
The left panel SHALL list all notes that are not archived in top-level groups: one per domain (by node in roadmap order inside), one per category of notes without a valid link, and an "Unsorted" group, always last, for notes with neither a valid link nor a category. It MUST offer a title filter. Each item MUST offer a "More actions" menu with Rename, Move to node and Archive, without changing what a click on the item does; Rename MUST show Save and Cancel. A collapsed "Archived" section below the groups SHALL show the archived count and, when expanded, list them with Restore and Delete.

#### Scenario: Grouped list
- **GIVEN** notes linked to `backend/caching`, `devops/ci-cd`, and one unsorted note without a category
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

### Requirement: Unsorted is grouped by category
Notes without a valid link that have a category SHALL be listed in a top-level group per category, headed by the category name like a domain heading; there is no separate Unsorted section around them. Domain and category groups are ordered together by their newest note, and the Unsorted group (no category) is last. The filter applies inside every group. While a note is dragged, the Unsorted group shows, also when empty, as the drop target that removes the topic.

#### Scenario: Categories in Unsorted
- **GIVEN** a note linked to `backend/caching` updated yesterday, unsorted notes "Pod limits" and "Helm charts" with category "Kubernetes" updated today, "Salary talk" with category "Career" updated last week, and "Loose idea" without a category
- **WHEN** the user looks at the Learned list
- **THEN** the top-level groups are Kubernetes, Backend, Career and Unsorted in that order, with no UNSORTED heading above Kubernetes or Career

#### Scenario: A linked note leaves its category group
- **WHEN** the user moves "Pod limits" to the node `devops/kubernetes`
- **THEN** it is listed under DevOps > Kubernetes and no longer under the Kubernetes group

### Requirement: Group unsorted notes with AI
The list toolbar SHALL have a "List actions" menu with a "Group with AI" item when at least one note has no topic. It sends the titles and the start of the text of the user's notes without a topic (the 200 newest) to the Note sorter agent in one model call and gives each note the category the agent picked; a note left out gets no category. While it runs the item MUST be disabled and show it is working. It counts like one chat request toward the limits.

#### Scenario: Group with AI
- **GIVEN** five notes without a topic and without a category
- **WHEN** the user opens List actions, chooses Group with AI and the agent answers with the groups "Kubernetes" (two notes) and "Career" (two notes)
- **THEN** the list shows the groups Kubernetes and Career with those notes, and Unsorted with the fifth

#### Scenario: Unreadable answer
- **WHEN** the agent's answer is not the expected JSON
- **THEN** an error is shown and no note's category changes

#### Scenario: No provider
- **GIVEN** the user has no provider for the Note sorter and no shared provider
- **WHEN** they choose Group with AI
- **THEN** the error says to set up a provider, and nothing changes

#### Scenario: Limits
- **WHEN** a member on the shared provider chooses Group with AI
- **THEN** it uses one request of their shared daily limit; the admin's runs use none

#### Scenario: Another user's notes
- **WHEN** user B runs Group with AI
- **THEN** user A's notes are neither sent to the model nor changed

#### Scenario: Nothing without a topic
- **WHEN** every note is linked to a node
- **THEN** the list toolbar shows no List actions menu

### Requirement: Rename a category group
Each category heading SHALL have a "More actions" menu, shown on hover or keyboard focus of the heading and always on touch screens, with Rename; Rename opens an inline field with Save and Cancel, and Save MUST stay disabled while the name is empty, longer than 40 characters or unchanged. Saving renames the category on all of the user's notes; renaming to an existing name merges the two groups. The Unsorted and domain headings have no such menu.

#### Scenario: Rename a group
- **WHEN** the user opens the menu of "Kubernetes", chooses Rename, types "K8s" and clicks Save
- **THEN** the group is called K8s with the same notes, and Cancel or Escape instead leaves it as Kubernetes

#### Scenario: No always-visible buttons
- **WHEN** the pointer is not over a category heading and nothing in it has focus, on a desktop
- **THEN** no Rename or menu button is visible on it

### Requirement: Three-pane layout
The web app SHALL show a top bar with the app title and the theme switch, and below it a left panel with the learned-items list, a center panel with the current page, and a right panel with the agent chat. The left and right panels MUST be collapsible, and the center takes the remaining width. Wider than a phone, each open side panel MUST be resizable with a handle on its inner edge, by pointer drag and by the arrow keys: left 200-480 px, right 280-640 px, center never under 360 px. A double-click on the handle restores the default width. Widths are kept in the browser across reloads; phones have no handles.

#### Scenario: App opens
- **WHEN** the user opens the app
- **THEN** the top bar, the three panels, the home page in the center and the agent chat on the right are visible

#### Scenario: Collapse a side panel
- **WHEN** the user collapses the left panel
- **THEN** the center widens to use the freed space, and the panel can be expanded again at the width it had

#### Scenario: Resize a side panel
- **WHEN** the user drags the left panel's handle 100 px to the right
- **THEN** the left panel is 100 px wider, the center is 100 px narrower, and after a reload the left panel keeps that width

#### Scenario: Limits while resizing
- **WHEN** the user drags the right panel's handle far to the left
- **THEN** the right panel stops at 640 px or where the center would become narrower than 360 px, whichever comes first

#### Scenario: Keyboard and reset
- **WHEN** the left panel's handle has focus and the user presses ArrowRight twice, then double-clicks the handle
- **THEN** the panel grows by 32 px, then returns to its default width

#### Scenario: Phone
- **WHEN** the app is used on a 390 px wide phone
- **THEN** no resize handle is shown and the side panels open as drawers as before
