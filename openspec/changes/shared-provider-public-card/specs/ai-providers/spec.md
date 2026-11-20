## ADDED Requirements

### Requirement: A shared configuration is shown as Public
The provider list SHALL show the tag "Public" on a configuration the admin shares. A member who runs on shared configurations SHALL see each of them as one more entry of their provider list, with its name, its model, the tag "Public", the words "Shared by the admin" and today's usage of the shared limit. That entry MUST be read-only and MUST NOT show the key, key hint, type, base URL, parameters or test result, and MUST NOT link to a configuration page.

#### Scenario: Admin sees Public
- **WHEN** the admin shares "Claude main" and opens the provider list
- **THEN** "Claude main" has the tag "Public" and a configuration that is not shared has none

#### Scenario: Member sees the shared provider as an entry
- **GIVEN** the admin shares "Claude main" and a member has no configuration of their own
- **WHEN** the member opens Settings > AI providers
- **THEN** the list holds an entry "Claude main" with its model, the tag "Public", "Shared by the admin" and "0 of 10 requests used today"

#### Scenario: The entry is read-only
- **WHEN** the member looks at the "Claude main" entry
- **THEN** it has no link, no button and no key hint, type or base URL

#### Scenario: Member with their own provider
- **GIVEN** a member has an active configuration of their own
- **WHEN** the member opens Settings > AI providers
- **THEN** the list holds their own configuration and no Public entry

#### Scenario: Sharing withdrawn
- **GIVEN** a member ran on "Claude main"
- **WHEN** the admin stops sharing it and the member opens Settings > AI providers
- **THEN** the Public entry is gone and the withdrawn warning is shown
