# node-linking Specification

## Purpose
Places each note on one roadmap node, so that learned knowledge is found by where it sits in a domain rather than by filename.

## Requirements

### Requirement: A note links to at most one roadmap node
The system SHALL let the user link a note to exactly one existing roadmap node, change that link to another node, or remove it. A note without a link is "unsorted".

#### Scenario: Link a note
- **WHEN** the user links a note to `backend/caching`
- **THEN** the note reports `backend/caching` as its node

#### Scenario: Move a note
- **GIVEN** a note is linked to `backend/caching`
- **WHEN** the user links it to `devops/monitoring`
- **THEN** the note reports only `devops/monitoring`

#### Scenario: Unlink a note
- **WHEN** the user removes a note's link
- **THEN** the note is unsorted

### Requirement: Links must target existing nodes
The system SHALL reject a link to a node id that does not exist in the loaded roadmaps and leave the note unchanged.

#### Scenario: Unknown node
- **WHEN** the user links a note to `backend/does-not-exist`
- **THEN** the request fails with a validation error and the note keeps its previous link

### Requirement: Query notes by node
The system SHALL return the notes linked to a given node, and the unsorted notes. Archived notes MUST NOT be returned by either query.

#### Scenario: Notes of a node
- **GIVEN** two notes are linked to `backend/caching`
- **WHEN** a client asks for the notes of `backend/caching`
- **THEN** it receives exactly those two notes

#### Scenario: Unsorted notes
- **WHEN** a client asks for unsorted notes
- **THEN** it receives every note that has no link

#### Scenario: Archived notes are left out
- **GIVEN** two notes on `backend/caching`, one of them archived
- **WHEN** a client asks for the notes of `backend/caching`
- **THEN** it receives only the one that is not archived

### Requirement: Per-domain note counts
The system SHALL return, for one domain, the number of notes linked to each of its nodes, so a map can mark the nodes that have notes. Archived notes MUST NOT be counted.

#### Scenario: Counts for a domain
- **GIVEN** two notes on `backend/caching` and one on `backend/auth`
- **WHEN** a client asks for the note counts of `backend`
- **THEN** it receives `caching: 2` and `auth: 1`, and no other node has a count above zero

#### Scenario: Archived notes are not counted
- **GIVEN** one note on `backend/auth`, and it is archived
- **WHEN** a client asks for the note counts of `backend`
- **THEN** `auth` has no count above zero

### Requirement: Links to removed nodes are kept and flagged
When a linked node no longer exists in the roadmaps, the system SHALL keep the note's stored link, flag it as pointing to a missing node, and list such notes together with the unsorted ones until the user relinks them.

#### Scenario: Node removed
- **GIVEN** a note is linked to `backend/soap` and that node was removed from the roadmap
- **WHEN** a client reads the note
- **THEN** the note reports node `backend/soap` flagged as missing, and it appears in the unsorted list
