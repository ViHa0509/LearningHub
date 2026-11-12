## MODIFIED Requirements

### Requirement: Sync to another Learning Hub
The Owner SHALL be able to send this server's data to another Learning Hub: on the target, create a sync key (shown once, valid 24 hours, a new one replacing the old); on the source, enter the target's https or localhost address and the key, then Send. The source MUST upload the backup in parts of at most 4 MB, and the target MUST restore it as a backup restore. The target MUST keep the parts in its file store, not in memory or on a disk that only one instance sees, and MUST remove them when the upload finishes, fails, or is older than 24 hours. The sync key MUST be stored only as a hash and work only for uploads.

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

#### Scenario: Backup larger than one part
- **GIVEN** a backup of 10 MB
- **WHEN** the Owner sends it
- **THEN** the source uploads three parts, none larger than 4 MB, and the target restores the whole backup

#### Scenario: Parts arrive on different instances
- **GIVEN** a target in serverless mode
- **WHEN** the parts and the finish call are handled by different instances
- **THEN** the restore succeeds and no part is left in the file store

#### Scenario: Another user's upload
- **WHEN** a part is sent to an upload that was started with another user's sync key
- **THEN** it is answered 404 and nothing is stored

## ADDED Requirements

### Requirement: Restore from the browser in parts
The Data & sync page SHALL upload a backup chosen for restore in parts of at most 4 MB, behind the session and the `X-LearningHub: 1` header, and restore it only after the Owner typed REPLACE. The assembled archive MUST pass the same checks as any restore (checksum, names, sizes, migration) before anything changes. These routes MUST NOT accept a sync key.

#### Scenario: Restore a 12 MB backup on Vercel
- **GIVEN** the hosted copy on Vercel and a backup file of 12 MB
- **WHEN** the Owner chooses the file, types REPLACE and restores
- **THEN** the page shows the upload progress, the data is replaced by the backup's, and the counts are shown

#### Scenario: Upload interrupted
- **WHEN** one part fails to upload
- **THEN** the page says the upload failed, nothing is restored, and the stored parts are removed

#### Scenario: Sync key refused
- **WHEN** a part is sent to the browser restore routes with a valid sync key and no session
- **THEN** it is answered 401
