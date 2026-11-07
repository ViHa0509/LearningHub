## ADDED Requirements

### Requirement: Archived notes are out of the agent's search
The agent's note search SHALL NOT return archived notes. Reading a note by its id still works for an archived note, so a note the user is looking at can be discussed.

#### Scenario: Search skips archived notes
- **GIVEN** two notes about redis, one of them archived
- **WHEN** the agent searches the notes for `redis`
- **THEN** only the note that is not archived is found

#### Scenario: Read an archived note on its page
- **GIVEN** the user is on the page of an archived note
- **WHEN** the agent reads that note by id
- **THEN** it receives the note's text
