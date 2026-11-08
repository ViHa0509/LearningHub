## MODIFIED Requirements

### Requirement: Providers are configured on the backend
The agent SHALL call models only through provider configurations managed in the app (see `ai-providers`), resolved per agent (see `agent-providers`). The chat request MUST name the agent (default `assistant`) and MAY name a provider configuration to use for that request; the chat panel never does, so in the app the agent's assignment decides. The request MUST NOT carry keys.

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
- **WHEN** a client sends a chat naming "Local qwen"
- **THEN** the answer comes from "Local qwen", and the assistant's assignment is unchanged

#### Scenario: Chat with an unavailable provider
- **WHEN** a client sends a chat naming a provider configuration that is switched off or does not exist
- **THEN** the system answers with a conflict or not-found error and calls no model

#### Scenario: The panel follows the assignment
- **GIVEN** the assistant is assigned "Claude main"
- **WHEN** the user asks a question in the chat panel
- **THEN** the request names no provider, "Claude main" answers, and the panel has no provider picker

### Requirement: Chat panel
The right panel SHALL show the chat: a header with the agent menu, Clear chat and Settings; user messages right and answers left, in Markdown with tables but never raw HTML, code blocks with Copy, and under each answer its tool trace, provider, model and effort (fallback marked), Copy and Retry; a composer with Enter to send and Shift+Enter for a new line, without a provider picker. With no active configuration it MUST link to Settings instead.

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
- **THEN** the panel shows the error in its own row under the question, with Retry, and the user can send again

#### Scenario: Choose the agent
- **WHEN** the user picks Lesson writer in the agent menu and sends a message
- **THEN** the request names the lesson writer agent, and the header shows it as the current agent

#### Scenario: Table in an answer
- **WHEN** an answer contains a Markdown table
- **THEN** it is shown as a table, and HTML tags in the answer are shown as text
