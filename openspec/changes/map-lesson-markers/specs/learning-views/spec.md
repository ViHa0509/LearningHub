## MODIFIED Requirements

### Requirement: Roadmap map with note markers
The center panel SHALL draw the roadmap of the selected domain as a graph of nodes and parent-child edges, mark every node that has notes with its note count, mark every node that has a lesson with a lesson mark, and let the user switch domains. A node with notes and a lesson shows both marks. The marks MUST follow a lesson saved or cleared on its lesson page, or written by the agent, without a reload.

#### Scenario: Marked nodes
- **GIVEN** two notes are linked to `backend/caching`
- **WHEN** the Backend map is shown
- **THEN** the Caching node is visibly marked with the count 2, and nodes without notes are not marked

#### Scenario: Node with a lesson
- **GIVEN** `backend/auth` has a lesson and no notes
- **WHEN** the Backend map is shown
- **THEN** the Auth node is visibly marked as having a lesson, and nodes without a lesson carry no lesson mark

#### Scenario: Notes and a lesson on one node
- **GIVEN** `backend/caching` has two notes and a lesson
- **WHEN** the Backend map is shown
- **THEN** the Caching node shows both the count 2 and the lesson mark

#### Scenario: Lesson mark follows the lesson
- **GIVEN** `backend/auth` has no lesson
- **WHEN** the user writes and saves a lesson on its lesson page and opens the Backend map
- **THEN** the Auth node carries the lesson mark
- **WHEN** the user clears the lesson and opens the map again
- **THEN** the mark is gone

#### Scenario: Lessons are per user
- **GIVEN** another user has a lesson on `backend/caching` and the current user has none
- **WHEN** the current user reads the Backend counts
- **THEN** `caching` is not listed among the nodes with a lesson

#### Scenario: Switch domain
- **WHEN** the user selects the DevOps domain
- **THEN** the map shows the DevOps roadmap
