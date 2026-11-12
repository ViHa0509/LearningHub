## MODIFIED Requirements

### Requirement: Three-pane layout
The web app SHALL show a top bar with the app title and the theme switch, and below it a left panel with the learned-items list, a center panel with the current page (home, roadmap map, lesson or note), and a right panel with the agent chat. The left and right panels MUST be collapsible, and the center panel takes the remaining width. This is the layout from 1100 px of viewport width; on narrower screens the same three parts are arranged as `responsive-layout` describes (one side panel at a time on a tablet, drawers on a phone).

#### Scenario: App opens
- **GIVEN** a viewport at least 1100 px wide
- **WHEN** the user opens the app
- **THEN** the top bar, the three panels, the home page in the center and the agent chat on the right are visible

#### Scenario: Collapse a side panel
- **WHEN** the user collapses the left panel
- **THEN** the center widens to use the freed space, and the panel can be expanded again
