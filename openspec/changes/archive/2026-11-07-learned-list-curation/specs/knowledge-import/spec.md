## MODIFIED Requirements

### Requirement: List, read, rename and delete notes
The system SHALL let the user list notes (newest first), read one note (title, text, metadata, link, archived state), change its title, archive and restore it, and delete it. Deleting a note also deletes its stored original file. The list MUST exclude archived notes unless the client asks for archived notes, in which case it returns only those.

#### Scenario: Rename a note
- **WHEN** the user changes a note's title to `Redis: eviction and TTL`
- **THEN** the note shows the new title and the original file is unchanged

#### Scenario: Delete a note
- **WHEN** the user deletes a note
- **THEN** the note no longer appears in any list and its original file is removed from storage

#### Scenario: Archive a note
- **GIVEN** a note linked to `backend/redis`
- **WHEN** the user archives it
- **THEN** the default note list no longer contains it, the list of archived notes does, and it keeps its title, link and original file

#### Scenario: Restore a note
- **GIVEN** an archived note
- **WHEN** the user restores it
- **THEN** it is back in the default note list with its link, and no longer in the archived list
