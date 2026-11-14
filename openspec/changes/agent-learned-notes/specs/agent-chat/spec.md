# Spec Delta

## ADDED Requirements

### Requirement: The assistant saves new topics as learned notes
When the user asks the assistant to explain a topic that has no note and no lesson yet, it SHALL save a learned note: a short write-up linked to the closest roadmap node or left unsorted, built into a page by the app with a fixed template (HTML in the text shown as text). A title or node that already has a note or lesson MUST NOT get another one.

#### Scenario: New topic
- **GIVEN** the user has no note or lesson about gRPC
- **WHEN** the user asks the assistant "explain gRPC"
- **THEN** the answer explains gRPC and names the saved note "gRPC", the Learned list shows it at the top with an "agent" badge, and opening it shows the write-up as a page

#### Scenario: Already known
- **GIVEN** a note titled "gRPC" exists
- **WHEN** the user asks the assistant about gRPC again
- **THEN** no second note is saved

#### Scenario: HTML in the write-up
- **WHEN** the saved Markdown contains `<script>`
- **THEN** the stored page shows it as text and contains no script element
