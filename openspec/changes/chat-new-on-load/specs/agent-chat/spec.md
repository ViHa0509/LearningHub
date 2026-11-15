## ADDED Requirements

### Requirement: A page load starts a new chat
The agent panel SHALL start every page load with an empty new chat: the previously open chat is not restored by the browser. Past chats stay on the server and are reached through History.

#### Scenario: Reload starts a new chat
- **GIVEN** a conversation with one answered question
- **WHEN** the user reloads the page
- **THEN** the panel shows no messages, the composer is ready, and the next question starts a new chat session

#### Scenario: The old chat is in History
- **GIVEN** the user reloaded the page after a conversation
- **WHEN** the user opens History and picks that conversation
- **THEN** its messages are shown and the next question continues it
