# Spec Delta

## MODIFIED Requirements

### Requirement: Two-way selection between list and map
Opening a note from the list SHALL also select its node, so that the map of its domain, when shown, highlights that node. Opening a node's lesson page from the map SHALL highlight that node's notes in the list. While a note is open, the list MUST mark only that note, not the other notes of its node; on other pages no note is marked.

#### Scenario: From list to map
- **WHEN** the user opens a note linked to `devops/ci-cd` from the list and then goes to the DevOps map
- **THEN** the map highlights the CI/CD node

#### Scenario: From map to list
- **WHEN** the user clicks the Caching node on the Backend map
- **THEN** the Caching lesson page opens and the list highlights the notes linked to `backend/caching`

#### Scenario: Only the open note is marked
- **GIVEN** two notes linked to the same node
- **WHEN** the user opens one of them
- **THEN** the list marks that note only
