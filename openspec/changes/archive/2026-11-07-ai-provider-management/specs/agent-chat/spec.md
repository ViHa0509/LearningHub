## MODIFIED Requirements

### Requirement: Providers are configured on the backend
The agent SHALL call models only through provider configurations managed in the app (see `ai-providers`), resolved per agent (see `agent-providers`). The chat request MUST name the agent (default `assistant`) and MAY name a provider configuration to use for this conversation. The request MUST NOT carry keys.

#### Scenario: No provider configured
- **GIVEN** no active provider configuration exists
- **WHEN** a client sends a chat
- **THEN** the system answers with a conflict error that points to Settings, and calls no model

#### Scenario: One provider configured
- **GIVEN** "Claude main" is the only active configuration and no agent has an assignment
- **WHEN** the user chats
- **THEN** "Claude main" answers, and the answer names it and its model

#### Scenario: Override for one conversation
- **GIVEN** the assistant uses "Claude main" and "Local qwen" is active
- **WHEN** the user picks "Local qwen" in the chat panel and asks a question
- **THEN** the answer comes from "Local qwen", and the assistant's assignment is unchanged

#### Scenario: Chat with an unavailable provider
- **WHEN** a client sends a chat naming a provider configuration that is switched off or does not exist
- **THEN** the system answers with a conflict or not-found error and calls no model

### Requirement: Chat panel
The right panel SHALL show the chat: a provider picker listing "Agent default" (with the resolved provider's name and model) and every active configuration, the conversation of this browser session with the agent's answers rendered as Markdown without raw HTML, the tool trace of each answer, which provider and model answered (and whether it was a fallback), a text box that sends on Enter (Shift+Enter for a new line), and a way to clear the conversation. When no configuration is active it MUST link to Settings instead of showing the text box.

#### Scenario: Ask a question
- **GIVEN** an active provider configuration
- **WHEN** the user types a question and presses Enter
- **THEN** the question appears, the panel shows that the agent is working, and the answer appears with its tool trace and the provider and model that answered

#### Scenario: Nothing configured
- **GIVEN** no active configuration
- **WHEN** the user opens the app
- **THEN** the panel says no AI provider is configured and links to Settings

#### Scenario: Error shown
- **WHEN** a chat request fails
- **THEN** the panel shows the error message under the question and the user can send again
