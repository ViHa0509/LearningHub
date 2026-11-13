# Spec Delta

## MODIFIED Requirements

### Requirement: Chat panel
The right panel SHALL show the chat: a header with the agent menu, New chat, History and Settings; user messages right and answers left, in Markdown with tables but never raw HTML, code blocks with Copy, and under each answer its tool trace, provider, model and effort (fallback marked), Copy and Retry; a composer with Enter to send and Shift+Enter for a new line, without a provider picker. New chat starts an empty conversation and leaves the previous one in History (see `chat-history`). With no active configuration it MUST link to Settings instead.

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

#### Scenario: New chat
- **GIVEN** a conversation with one answered question
- **WHEN** the user presses New chat and sends another question
- **THEN** the panel shows only the new question and its answer, and History lists two chats
