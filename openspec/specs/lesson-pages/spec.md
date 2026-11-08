# lesson-pages Specification

## Purpose
Gives every roadmap node its own page with its place in the roadmap, its subtopics, the notes linked to it, and a lesson text the user or the agent writes.

## Requirements

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

### Requirement: Ask the agent to draft an empty lesson
A lesson page whose lesson is empty SHALL offer a "Draft with agent" action when a provider is available. It sends a request to draft this lesson to the agent chat, and the page shows the lesson once the agent has written it.

#### Scenario: Draft from the lesson page
- **GIVEN** a provider is available and `backend/graphql` has no lesson
- **WHEN** the user clicks "Draft with agent" on the GraphQL lesson page
- **THEN** the agent chat receives a request to draft this lesson, and after the agent writes it the page shows the lesson text

#### Scenario: No provider
- **GIVEN** no provider is available
- **WHEN** the user opens an empty lesson page
- **THEN** no "Draft with agent" action is shown

### Requirement: Export a lesson as PDF
The lesson page SHALL offer Export PDF, which opens the browser's print dialog on a layout holding only the lesson (breadcrumb, title, description, rendered lesson, and references as plain links), with the lesson title as the suggested file name. It MUST be disabled while the lesson is empty.

#### Scenario: Export a written lesson
- **GIVEN** the lesson of `devops/docker` has text
- **WHEN** the user clicks Export PDF
- **THEN** the print dialog opens with the document titled after the lesson, and the app panels, buttons and chat are not part of the printed page

#### Scenario: Nothing to export
- **WHEN** the lesson is empty
- **THEN** Export PDF is disabled

### Requirement: Import a PDF into the lesson editor
The lesson page SHALL offer Import PDF. The system extracts the PDF's text (at most 10 MB, 200 pages, 100 000 characters; paragraphs and bullet lists kept) and opens it in the lesson editor without saving; the lesson changes only when the user clicks Save. When the editor already has text, the app MUST ask before replacing it. A file that is not a readable PDF MUST be refused with the reason, and a PDF without a text layer MUST say so. The PDF is not stored.

#### Scenario: Import and save
- **WHEN** the user imports a PDF whose text is "Docker images" and a bullet "• layers"
- **THEN** the editor shows that text with `- layers` as a list item, nothing is saved yet, and after Save the lesson shows it

#### Scenario: Ask before replacing
- **GIVEN** the lesson already has text
- **WHEN** the user imports a PDF
- **THEN** the app asks whether to replace the editor's text, and keeps it when the user declines

#### Scenario: Not a PDF
- **WHEN** the user imports a file that is not a PDF, or an encrypted PDF
- **THEN** the import is refused with the reason and the lesson is unchanged

#### Scenario: Scanned PDF
- **WHEN** the user imports a PDF with no text layer
- **THEN** the app says the PDF has no text to import
