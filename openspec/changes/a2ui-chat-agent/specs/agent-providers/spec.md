# Spec Delta

## MODIFIED Requirements

### Requirement: Agents are defined in code and listed
The system SHALL define its agents in code, each with an id, a name, a description and its instructions. There are four: `assistant` ("Learning assistant", the chat panel), `lesson-writer` ("Lesson writer", used by Draft with agent), `outline` ("Topic outline", used by Draft with agent on an empty area) and `a2ui` ("Interactive tutor", called by the assistant for interactive quizzes, practice and lessons). Clients MUST be able to list the agents with their primary and fallback provider, each provider's model, and its status.

#### Scenario: List agents
- **WHEN** a client lists agents
- **THEN** it receives the Learning assistant, the Lesson writer, the Topic outline and the Interactive tutor, each with its primary and fallback provider or none
