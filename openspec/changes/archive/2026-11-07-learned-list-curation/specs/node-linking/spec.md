## MODIFIED Requirements

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
