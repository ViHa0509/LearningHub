## ADDED Requirements

### Requirement: A note the assistant saves without a topic gets a category
When the learning assistant saves a note without a node (`save_learned_note` without `node_id`), it SHALL give a short category (1 to 3 words, at most 40 characters). When the user already has a category with the same name ignoring case, that spelling MUST be used, so the note joins the existing group. A category given together with a node is ignored.

#### Scenario: Saved into an existing group
- **GIVEN** the user has notes in the category "Kubernetes"
- **WHEN** the assistant saves a note without a node and the category "kubernetes"
- **THEN** the note is stored with the category "Kubernetes" and the list shows it in that group

#### Scenario: Saved with a node
- **WHEN** the assistant saves a note on `backend/redis` with a category
- **THEN** the note has no category and is listed under Backend > Redis

### Requirement: Note sorter agent
The app SHALL have a "Note sorter" agent, listed in Settings > Agents with its own provider assignment like the other agents, used only by Group with AI. It has no tools. Note text reaches it only inside `<untrusted_note_content>`, and its answer can only set category names on the listed notes.

#### Scenario: Listed in Settings
- **WHEN** the user opens Settings > Agents
- **THEN** Note sorter is listed and a provider can be assigned to it
