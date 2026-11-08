## MODIFIED Requirements

### Requirement: Provider resolution
The system SHALL use, in this order: a provider override given with the chat request; the agent's primary provider when it is active; for an agent without any assignment of its own, the Learning assistant's primary when it is active; then the first active configuration by creation time. An agent without an assignment also uses the assistant's fallback. If no active configuration exists, the request MUST be refused with a conflict error that points to Settings.

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
