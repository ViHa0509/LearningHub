## ADDED Requirements

### Requirement: Ask the agent to draft an empty lesson
A lesson page whose lesson is empty SHALL offer a "Draft with agent" action when a provider is available. It sends a request to draft this lesson to the agent chat, and the page shows the lesson once the agent has written it.

#### Scenario: Draft from the lesson page
- **GIVEN** a provider is available and `backend/graphql` has no lesson
- **WHEN** the user clicks "Draft with agent" on the GraphQL lesson page
- **THEN** the agent chat receives a request to draft this lesson, and after the agent writes it the page shows the lesson text

#### Scenario: No provider
- **GIVEN** no provider is available
- **WHEN** the user opens an empty lesson page
- **THEN** no "Draft with agent" action is shown
