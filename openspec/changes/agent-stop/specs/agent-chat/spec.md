## ADDED Requirements

### Requirement: The user can stop a running answer
The user SHALL be able to stop the agent's running answer. After the stop is seen, the agent MUST make no further model call and start no further tool call; a tool call already started finishes. The stopped turn SHALL be stored with the steps done so far and the reply "Stopped by you.". A stop MUST change only the user's own running run. A stopped request still counts toward the rate and daily limits.

#### Scenario: Stop a slow answer
- **GIVEN** the agent is working on a question
- **WHEN** the user presses Stop
- **THEN** the panel stops showing that the agent works, the answer row shows "Stopped by you." with the Stopped mark, and Send is available again

#### Scenario: No tool call after the stop
- **GIVEN** the model asked for two tool calls and the stop arrives while the first one runs
- **WHEN** the first tool call ends
- **THEN** the second tool call is not run, the model is not called again, and the trace lists only the first call

#### Scenario: A lesson written before the stop stays
- **GIVEN** the agent wrote a lesson and then the user pressed Stop
- **WHEN** the user opens that lesson
- **THEN** the lesson holds the written text, and the stopped answer's trace lists the write

#### Scenario: Stopped turn in history
- **WHEN** the user stops an answer and later opens that chat from History
- **THEN** the question and the stopped answer are shown with the steps done before the stop

#### Scenario: Retry a stopped answer
- **WHEN** the user presses Retry on a stopped answer
- **THEN** the question is sent again and its new answer replaces the stopped one

#### Scenario: Claude Code run stopped
- **GIVEN** the agent's provider is of type Claude Code and its run is going
- **WHEN** the user presses Stop
- **THEN** the claude process and the processes it started are ended, and the answer is stored as stopped

#### Scenario: Another user's run
- **WHEN** a user sends a stop for a run id of another user
- **THEN** the answer is the same as for an unknown run, and the other user's run goes on

#### Scenario: Stop after the answer came
- **WHEN** a stop arrives for a run that already ended
- **THEN** nothing changes and the stored answer stays as it was

## MODIFIED Requirements

### Requirement: Chat panel
The right panel SHALL show the chat: a header with the agent menu, Clear chat and Settings; user messages right and answers left, in Markdown with tables but never raw HTML, code blocks with Copy, and under each answer its tool trace, provider, model and effort (fallback marked), Copy and Retry; a composer with Enter to send and Shift+Enter for a new line, without a provider picker. While the agent works, the composer's Send button SHALL be a Stop button. With no active configuration it MUST link to Settings instead.

#### Scenario: Ask a question
- **GIVEN** an active provider configuration
- **WHEN** the user types a question and presses Enter
- **THEN** the question appears, the panel shows that the agent is working with a Stop button, and the answer appears with its tool trace and the provider and model that answered

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
