## ADDED Requirements

### Requirement: Share a configuration with all users
The admin SHALL be able to mark a provider configuration as shared with every signed-in user. A configuration is private unless shared. A member MUST NOT share, and a Claude Code configuration MUST NOT be shared. Other users MUST NOT see a shared configuration's key, key hint, base URL, parameters or test result, and cannot test, change or delete it.

#### Scenario: Admin shares
- **WHEN** the admin ticks "Shared with all users" on "Claude main" and saves
- **THEN** the list shows "Claude main" with a Public badge

#### Scenario: Member cannot share
- **WHEN** a member saves one of their configurations as shared
- **THEN** the system answers forbidden and the configuration stays private

#### Scenario: Claude Code cannot be shared
- **WHEN** the admin saves a Claude Code configuration as shared
- **THEN** the system refuses it and says Claude Code cannot be shared

#### Scenario: Hidden from other users
- **GIVEN** the admin shares "Claude main"
- **WHEN** a member lists their configurations, or reads, tests, updates or deletes "Claude main" by its id
- **THEN** the list does not hold it and each call by id answers not found

#### Scenario: Unshare
- **WHEN** the admin unticks "Shared with all users" and saves
- **THEN** users without a configuration of their own can no longer run the agents on it

#### Scenario: Backup
- **WHEN** the admin restores a backup that held a shared configuration
- **THEN** the restored configuration is private
