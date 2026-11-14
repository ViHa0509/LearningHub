# Spec Delta

## MODIFIED Requirements

### Requirement: Lesson content is rendered safely
Lesson text SHALL be rendered as Markdown without executing or embedding raw HTML from the text, in the lesson template: reading time, a contents box when there are two or more `## ` sections, each section as a numbered card, a section named Key takeaways highlighted, GitHub-style alerts as callouts, tables and code blocks with Copy.

#### Scenario: HTML in a lesson
- **GIVEN** a lesson text contains `<script>alert(1)</script>`
- **WHEN** the lesson page shows it
- **THEN** no script runs and the tag is not inserted into the page as HTML

#### Scenario: Lesson template
- **GIVEN** a lesson with an intro, the sections Overview, How it works and Key takeaways, a `> [!KEY]` alert and a table
- **WHEN** the lesson page shows it
- **THEN** it shows the reading time, a contents box listing the three sections, three numbered cards with Key takeaways highlighted, the alert as a "Key idea" callout without its marker, and the table

#### Scenario: Short lesson
- **WHEN** a lesson has no `## ` section
- **THEN** only its text and the reading time are shown, without contents box or cards

### Requirement: Ask the agent to draft an empty lesson
A lesson page whose lesson is empty SHALL offer a "Draft with agent" action when a provider is available. It sends a request to draft this lesson to the agent chat, and the page shows the lesson once the agent has written it. The lesson writer MUST write plain Markdown in a fixed outline (Overview, Key ideas, How it works, Example, Common pitfalls, Key takeaways, Sources; about 500 to 900 words; at most two callouts) and never HTML or CSS.

#### Scenario: Draft from the lesson page
- **GIVEN** a provider is available and `backend/graphql` has no lesson
- **WHEN** the user clicks "Draft with agent" on the GraphQL lesson page
- **THEN** the agent chat receives a request to draft this lesson, and after the agent writes it the page shows the lesson text

#### Scenario: No provider
- **GIVEN** no provider is available
- **WHEN** the user opens an empty lesson page
- **THEN** no "Draft with agent" action is shown

#### Scenario: Fixed outline for the writer
- **WHEN** the lesson writer is asked to draft a lesson
- **THEN** its instructions name the outline sections in order and forbid HTML and CSS, and the assistant's instructions do not include them
