# data-sync Specification

## Purpose
Move the user's data between Learning Hub servers (Local and Deploy): a backup .zip without keys or passwords, a validated restore that replaces the data after an automatic backup, and a one-click sync to another server with a short-lived sync key.

## Requirements

### Requirement: Download a backup
The Settings page Data & sync SHALL let the Owner download a .zip backup with a manifest (app version, migration, counts) holding the notes with their original files, lessons, node links, archive state, AI provider configurations without keys, agent assignments and agent settings. The backup MUST NOT hold any account, session, one-time token, password, API key or OAuth secret.

#### Scenario: Backup content
- **GIVEN** two notes with files, one lesson and one provider with a key
- **WHEN** the Owner downloads a backup
- **THEN** the archive holds both notes with their files, the lesson and the provider's name and model, and no key, token or password appears in it

### Requirement: Restore a backup
The Owner SHALL be able to restore a backup .zip on a server after typing REPLACE. Restoring MUST replace the notes, files, lessons, links, provider configurations and agent settings with the backup's, in one database transaction, after saving an automatic backup of the replaced data (the last 3 are kept). Providers restored without a key MUST be shown as needing a key. A backup from a newer database migration, or an invalid archive, MUST be refused without changing anything.

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

### Requirement: Sync to another Learning Hub
The Owner SHALL be able to send this server's data to another Learning Hub: on the target, create a sync key (shown once, valid 24 hours, a new one replacing the old); on the source, enter the target's https or localhost address and the key, then Send. The source MUST upload the backup in parts of at most 50 MB, and the target MUST restore it as a backup restore. The sync key MUST be stored only as a hash and work only for uploads.

#### Scenario: Send Local to Deploy
- **GIVEN** a sync key created on the target
- **WHEN** the Owner sends from the source with the target's address and the key
- **THEN** the target holds the source's notes, files and lessons, and the source shows what was copied

#### Scenario: Wrong or expired key
- **WHEN** an upload uses a wrong key, or a key older than 24 hours
- **THEN** the target answers 401 and changes nothing

#### Scenario: Key works only for uploads
- **WHEN** a request to a data route such as `/api/notes` carries a valid sync key and no session
- **THEN** it is answered 401
