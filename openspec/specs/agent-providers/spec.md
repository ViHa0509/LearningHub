# agent-providers Specification

## Purpose
Lets each agent use its own provider configuration with an optional fallback on recoverable errors, resolved at request time and logged without secrets.

## Requirements

### Requirement: Agents are defined in code and listed
The system SHALL define its agents in code, each with an id, a name, a description and its instructions. There are two: `assistant` ("Learning assistant", the chat panel) and `lesson-writer` ("Lesson writer", used by Draft with agent). Clients MUST be able to list the agents with their primary and fallback provider, each provider's model, and its status.

#### Scenario: List agents
- **WHEN** a client lists agents
- **THEN** it receives the Learning assistant and the Lesson writer, each with its primary and fallback provider or none

### Requirement: Assign providers to an agent
The user SHALL be able to set or clear an agent's primary provider and its optional fallback provider. Fallback and primary MUST differ. Several agents MAY share one provider, and changing a provider configuration applies to every agent that uses it, with no change to agent code.

#### Scenario: Different providers per agent
- **WHEN** the user assigns "Claude main" to the assistant and "Local qwen" to the lesson writer
- **THEN** chat requests use Claude, and lesson drafts use the local model

#### Scenario: Same provider twice
- **WHEN** the user sets the same configuration as primary and fallback
- **THEN** the system refuses it

#### Scenario: Unknown provider
- **WHEN** the user assigns a provider id that does not exist
- **THEN** the system refuses it and nothing changes

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

### Requirement: Fallback on recoverable errors only
When the primary provider fails with a recoverable error (`timeout`, `rate_limited` or `unavailable`) and the agent has an active fallback, the system SHALL log the fallback and use the fallback provider for the rest of that request. It MUST NOT fall back on `auth_failed`, `invalid_model` or `invalid_config`. When both fail, the error MUST name both providers and their error categories. The answer says whether a fallback was used and which provider and model answered.

#### Scenario: Rate limited primary
- **GIVEN** the assistant's primary answers 429 and its fallback works
- **WHEN** the user chats
- **THEN** the answer comes from the fallback, it is marked as a fallback with the fallback's provider name and model, and a fallback event is logged with the agent id, both provider ids and the error category

#### Scenario: Wrong key does not fall back
- **GIVEN** the primary answers 401
- **WHEN** the user chats
- **THEN** the request fails with an authentication error and the fallback is not called

#### Scenario: Both fail
- **GIVEN** the primary times out and the fallback is unavailable
- **WHEN** the user chats
- **THEN** the error names both providers with `timeout` and `unavailable`

### Requirement: LLM calls are observable without secrets
The system SHALL log each model call, connection test, fallback and failure as a structured record. Each record carries the agent id, provider id, provider type, model, duration and error category, and never the key or the prompt and answer text.

#### Scenario: Log records
- **WHEN** the agent answers a chat after two model calls
- **THEN** two call records exist with these fields, and none contains the user's message text or the key
