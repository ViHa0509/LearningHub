# Spec Delta

## MODIFIED Requirements

### Requirement: Download a backup
The Settings page Data & sync SHALL let the Owner download a .zip backup with a manifest (app version, migration, counts) holding the notes with their original files, lessons, node links, archive state, AI provider configurations without keys, agent assignments, agent settings and the chat history (sessions with their messages). The backup MUST NOT hold any account, session, one-time token, password, API key or OAuth secret.

#### Scenario: Backup content
- **GIVEN** two notes with files, one lesson and one provider with a key
- **WHEN** the Owner downloads a backup
- **THEN** the archive holds both notes with their files, the lesson and the provider's name and model, and no key, token or password appears in it

#### Scenario: Chat history in the backup
- **GIVEN** one chat session with a question and an answer
- **WHEN** the Owner downloads a backup
- **THEN** the archive holds that session with both messages, and the manifest counts one chat session and two chat messages

### Requirement: Restore a backup
The Owner SHALL be able to restore a backup .zip on a server after typing REPLACE. Restoring MUST replace the notes, files, lessons, links, provider configurations, agent settings and chat history with the backup's, in one database transaction, after saving an automatic backup of the replaced data (the last 3 are kept). A backup that holds no chat history (made before chat history existed) MUST restore and leave the server's chat history unchanged. Providers restored without a key MUST be shown as needing a key. A backup from a newer database migration, or an invalid archive, MUST be refused without changing anything.

#### Scenario: Restore replaces the data
- **GIVEN** a server with one note and a backup with two other notes
- **WHEN** the Owner restores the backup after typing REPLACE
- **THEN** the server has exactly the backup's two notes with their files, and an automatic backup of the replaced note is kept

#### Scenario: Unsafe archive refused
- **WHEN** a backup holds an entry named `../evil.txt` or expands beyond the size limit
- **THEN** it is refused with the reason and nothing is changed

#### Scenario: Provider keys entered again
- **GIVEN** a restored backup with a provider configuration
- **WHEN** the Owner opens AI providers
- **THEN** the provider is listed and marked as needing its key

#### Scenario: Restore replaces the chat history
- **GIVEN** a server with chat session "A" and a backup holding chat session "B"
- **WHEN** the Owner restores the backup
- **THEN** History lists only "B" with its messages

#### Scenario: Backup without chat history
- **GIVEN** a server with chat session "A" and a backup made before chat history existed
- **WHEN** the Owner restores the backup
- **THEN** the restore succeeds and History still lists "A"
