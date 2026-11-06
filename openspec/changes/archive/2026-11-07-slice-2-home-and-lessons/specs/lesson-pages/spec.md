## ADDED Requirements

### Requirement: Every roadmap node has a lesson page
The app SHALL show a lesson page for any node of any loaded domain. The page MUST show a breadcrumb (domain, then ancestors, then the node), the node's description from the roadmap, its direct subtopics as links to their lesson pages, the notes linked to the node as links that open each note, and the node's lesson content.

#### Scenario: Open a lesson from the map
- **WHEN** the user clicks the Caching node on the Backend map
- **THEN** the Caching lesson page is shown with the breadcrumb "Backend > Caching", the node's description, the subtopic Redis and the notes linked to `backend/caching`

#### Scenario: Node without notes or content
- **GIVEN** no note is linked to `backend/graphql` and it has no lesson content
- **WHEN** the user opens its lesson page
- **THEN** the page shows the title and description, says that no notes are linked, and shows an empty lesson area with a prompt to write the lesson

#### Scenario: Unknown node
- **WHEN** the user opens the lesson address of a node that does not exist
- **THEN** the app says the lesson was not found and offers a link back to the domain's roadmap

### Requirement: Lesson content is stored per node and editable
The system SHALL store at most one lesson text per node, written in Markdown, together with its source (`user`, `agent` or `import`) and the time it was last changed. Clients MUST be able to read and replace it; saving an empty text removes it. Writing to a node that does not exist MUST be rejected.

#### Scenario: Write a lesson
- **WHEN** the user writes "Cache-aside: read the cache, fall back to the database" for `backend/caching` and saves
- **THEN** the lesson page shows that text rendered as Markdown, and it is still there after the backend restarts

#### Scenario: Read a node without lesson
- **WHEN** a client reads the lesson of `backend/graphql`, which has none
- **THEN** it receives an empty text with no source

#### Scenario: Clear a lesson
- **WHEN** the user saves an empty text for `backend/caching`
- **THEN** the lesson is removed and the page shows the empty lesson area again

#### Scenario: Unknown node is rejected
- **WHEN** a client writes a lesson for `backend/not-a-node`
- **THEN** the system answers with a not-found error and stores nothing

### Requirement: Lesson content is rendered safely
Lesson text SHALL be rendered as Markdown without executing or embedding raw HTML from the text.

#### Scenario: HTML in a lesson
- **GIVEN** a lesson text contains `<script>alert(1)</script>`
- **WHEN** the lesson page shows it
- **THEN** no script runs and the tag is not inserted into the page as HTML

### Requirement: Further reading link
A lesson page SHALL link to roadmap.sh for the node's domain, opened in a new tab, so the user can look up the topic there.

#### Scenario: Link to roadmap.sh
- **WHEN** the user opens the lesson page of `devops/docker`
- **THEN** the page has a link to `https://roadmap.sh/devops` that opens in a new tab
