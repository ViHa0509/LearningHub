## MODIFIED Requirements

### Requirement: Provider resolution
The system SHALL use, in this order: a provider override given with the chat request; the agent's active primary; for an agent without an assignment of its own, the Learning assistant's active primary (and its fallback); the user's first active configuration by creation time; then, for a user with no active configuration, the shared configurations. If none exists, the request MUST be refused with a conflict error that points to Settings.

#### Scenario: No assignment
- **GIVEN** the lesson writer has no provider and "Claude main" is the only active configuration
- **WHEN** the user drafts a lesson
- **THEN** "Claude main" is used

#### Scenario: Primary switched off
- **GIVEN** the assistant's primary provider is switched off and another configuration is active
- **WHEN** the user chats
- **THEN** the first active configuration is used

#### Scenario: Unassigned agent follows the assistant
- **GIVEN** the assistant's primary is "Claude sub" and its fallback is "Claude main", the lesson writer has no assignment, and "Claude main" was created first
- **WHEN** the user drafts a lesson
- **THEN** "Claude sub" answers, "Claude main" is the fallback, and Settings shows the lesson writer uses "Claude sub" (same as the Learning assistant)

#### Scenario: Own assignment wins
- **GIVEN** the lesson writer's own primary is "Local qwen" and the assistant's primary is "Claude sub"
- **WHEN** the user drafts a lesson
- **THEN** "Local qwen" answers

#### Scenario: Shared configuration for a user without one
- **GIVEN** the admin shares "Claude main" and a member has no configuration
- **WHEN** the member chats
- **THEN** "Claude main" answers, and Settings shows the member that the agents use "Claude main", shared by the admin, with its model and no key hint

#### Scenario: Own configuration wins over a shared one
- **GIVEN** the admin shares "Claude main" and a member has the active configuration "My key"
- **WHEN** the member chats
- **THEN** "My key" answers

#### Scenario: No shared configuration
- **GIVEN** no configuration is shared and a member has none
- **WHEN** the member chats
- **THEN** the request is refused with a conflict error that points to Settings

#### Scenario: Shared configuration switched off
- **GIVEN** the admin switches the only shared configuration off and a member has no configuration
- **WHEN** the member chats
- **THEN** the request is refused with a conflict error that points to Settings

## ADDED Requirements

### Requirement: Shared agent setup
A user with no active configuration of their own SHALL run each agent as the admin set it up, using only shared active configurations: the admin's primary and fallback for that agent, and the admin's Internet search switch for it. An assignment of the admin's that is not shared is skipped, and the first shared configuration is used in its place.

#### Scenario: Agent follows the admin's assignment
- **GIVEN** the admin shares "Claude main" and "Claude fast", and the admin's lesson writer uses "Claude fast"
- **WHEN** a member without a configuration drafts a lesson
- **THEN** "Claude fast" answers

#### Scenario: Private assignment is skipped
- **GIVEN** the admin's lesson writer uses the private "Local qwen" and the admin shares "Claude main"
- **WHEN** a member without a configuration drafts a lesson
- **THEN** "Claude main" answers

#### Scenario: Internet search follows the admin
- **GIVEN** the admin switched Internet search on for the assistant
- **WHEN** a member without a configuration chats
- **THEN** the assistant may search the Internet

### Requirement: Daily limit on shared configurations
Each agent request that runs on a shared configuration SHALL count against the asking user's daily limit (10 a day by default, UTC day), one count per request. A request over the limit MUST be refused before any model call, with a message that says the limit and points to Settings. The admin's own requests are not counted, and one user's count never affects another's.

#### Scenario: Count shown
- **GIVEN** a member without a configuration who sent 3 chat messages today
- **WHEN** the member opens Settings -> Agents
- **THEN** it shows 3 of 10 requests used today

#### Scenario: Over the limit
- **GIVEN** a member who used all 10 requests today
- **WHEN** the member sends another chat message
- **THEN** the chat shows that the daily limit of 10 requests is reached and when it resets, and no model is called

#### Scenario: Another user
- **GIVEN** one member is over the limit
- **WHEN** another member chats
- **THEN** the other member is answered

#### Scenario: Next day
- **GIVEN** a member was over the limit yesterday (UTC)
- **WHEN** the member chats today
- **THEN** the member is answered

#### Scenario: Admin is not counted
- **WHEN** the admin chats on their own shared configuration
- **THEN** no count is taken

### Requirement: Warning when the shared configuration is withdrawn
When a user who ran the agents on shared configurations in the last 30 days has no configuration of their own and no shared configuration is available any more, the system SHALL show a warning icon where the provider is shown, saying the shared provider is no longer available and pointing to adding a provider. A user with a configuration of their own keeps using it and sees no warning.

#### Scenario: Unshared
- **GIVEN** a member without a configuration who chatted on the shared "Claude main" yesterday
- **WHEN** the admin unshares "Claude main" and the member opens Settings -> Agents
- **THEN** a warning icon says the shared provider is no longer available and links to the providers page

#### Scenario: Switched off or deleted
- **WHEN** the admin switches the shared "Claude main" off, or deletes it
- **THEN** the same member sees the same warning

#### Scenario: Falls back to the user's own configuration
- **GIVEN** a member with the warning
- **WHEN** the member adds an active configuration "My key" and chats
- **THEN** "My key" answers and the warning is gone

#### Scenario: Shared again
- **WHEN** the admin shares a configuration again
- **THEN** the member's warning is gone and the agents answer

#### Scenario: User who never used it
- **GIVEN** a member without a configuration who never ran the agents on a shared configuration
- **WHEN** no configuration is shared
- **THEN** the member sees the usual hint to add a provider, without the warning

### Requirement: Shared setup is read-only
A user who runs on shared configurations SHALL see, per agent, the provider name, its model and the Internet search state as the admin set them, without controls to change them. The user's own controls return when they have a configuration of their own.

#### Scenario: Read-only rows
- **GIVEN** a member without a configuration and a shared "Claude main"
- **WHEN** the member opens Settings -> Agents
- **THEN** each agent shows "Claude main", shared by the admin, and no provider or Internet search control

#### Scenario: Assigning the shared configuration is refused
- **WHEN** that member sends a request that assigns the shared configuration to an agent
- **THEN** the system refuses it as an unknown provider
