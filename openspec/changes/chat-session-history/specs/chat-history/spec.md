# Spec Delta

## Purpose

Keeps each user's conversations with the agent on the server as chat sessions, so a past chat can be found, read again and continued, and so chats survive a reload or another device.

## ADDED Requirements

### Requirement: Chats are saved as sessions
The system SHALL save every answered chat request in a chat session of the signed-in user. A request without a session creates one, titled with the first 60 characters of the first user message as typed ("New chat" when it has no text). The answer MUST name the session (id and title) and the ids of the stored user message and answer. A request that fails MUST store nothing.

#### Scenario: First message creates a session
- **GIVEN** an active provider and no chat sessions
- **WHEN** the user sends "what did I learn about redis eviction?" without a session
- **THEN** the answer names a new session titled "what did I learn about redis eviction?", and that session holds the question and the answer

#### Scenario: Failed request stores nothing
- **GIVEN** a provider that returns an error
- **WHEN** the user sends a first message
- **THEN** the system answers with the bad-gateway error and the user has no chat session

#### Scenario: Message with only files
- **WHEN** the first message of a chat has an attached file and no typed text
- **THEN** the session is titled "New chat"

### Requirement: A stored message keeps what the panel shows
The system SHALL store, for a user message, the text as typed, the text as sent, the agent it was sent to and the names of its attached files; and for an answer, its text, tool trace (name, input, summary), provider name, model, effort, fallback mark and whether the step limit stopped it. The text of attached files MUST NOT be stored.

#### Scenario: Answer details are kept
- **GIVEN** an answer that used two tools, from "Claude main" with effort high
- **WHEN** the session is read later
- **THEN** the answer comes back with both tool calls, "Claude main", its model and effort high

#### Scenario: Skill message
- **WHEN** the user sends `/quiz JWT` and reads the session later
- **THEN** the stored message shows `/quiz JWT` as typed, and its sent text starts with the quiz instruction

#### Scenario: Attachment text is not kept
- **GIVEN** a message sent with the file `jwt.md`
- **WHEN** the session is read later
- **THEN** the message lists the name `jwt.md`, and the file's text appears nowhere in the stored session

### Requirement: Continue a session
A chat request that names a session SHALL carry only the new user message, and the system SHALL send the model the session's stored conversation (at most its 50 most recent messages) followed by that message, then store the new turn at the end of the session. An unknown session MUST be answered not-found, and a request that names a session but carries more than one message MUST be refused, both without calling a model.

#### Scenario: Follow-up uses the stored history
- **GIVEN** a session holding "what is JWT?" and its answer
- **WHEN** the user sends "and how does it expire?" naming that session
- **THEN** the model receives the earlier question and answer before the new message, and the session then holds four messages

#### Scenario: Unknown session
- **WHEN** a chat request names a session id that does not exist
- **THEN** the system answers not-found and calls no model

#### Scenario: History sent with a session
- **WHEN** a chat request names a session and carries three messages
- **THEN** the system answers with a bad-request error and calls no model

### Requirement: Retry replaces the turn in the session
A chat request MAY name a stored user message of its session to retry from. When the request is answered, the system SHALL remove that message and every message after it from the session and store the new turn in their place. A message id that is not a user message of that session MUST be answered not-found without calling a model; a failed retry MUST leave the session unchanged.

#### Scenario: Retry an answer
- **GIVEN** a session with two question-and-answer turns
- **WHEN** the user retries the first answer
- **THEN** the session holds one turn: the first question and the new answer

#### Scenario: Failed retry keeps the session
- **GIVEN** a session with one turn and a provider that now returns an error
- **WHEN** the user retries the answer
- **THEN** the session still holds the original question and answer

### Requirement: List, read, rename and delete sessions
The system SHALL let the signed-in user list their chat sessions newest activity first (title, time of the last message, message count), read one with all its messages in order, rename it (1 to 120 characters after trimming) and delete it with its messages. Renaming MUST NOT change its place in the list.

#### Scenario: List order
- **GIVEN** sessions "A" and "B", and the last message of "A" is newer
- **WHEN** the user lists the sessions
- **THEN** "A" comes first, each with its message count

#### Scenario: Rename
- **WHEN** the user renames a session to "JWT expiry"
- **THEN** the list shows "JWT expiry" at the same place

#### Scenario: Empty title refused
- **WHEN** the user renames a session to a title of only spaces
- **THEN** the system answers with a validation error and the title is unchanged

#### Scenario: Delete
- **WHEN** the user deletes a session
- **THEN** it is gone from the list, and reading it answers not-found

### Requirement: Chat sessions are separate per user
Every chat session SHALL belong to one user. Listing returns only the signed-in user's sessions; reading, renaming, deleting or continuing another user's session MUST be answered not-found, and no request without a signed-in session may reach them. Deleting a user MUST delete their chat sessions.

#### Scenario: Another user's session
- **GIVEN** a session of user A
- **WHEN** user B reads, renames, deletes or continues it by its id
- **THEN** each request is answered not-found, the session is unchanged and no model is called

#### Scenario: Lists do not mix
- **GIVEN** users A and B each have one session
- **WHEN** B lists the sessions
- **THEN** only B's session is listed

#### Scenario: Not signed in
- **WHEN** a request without a signed-in session lists the chat sessions
- **THEN** it is answered 401

### Requirement: History in the chat panel
The chat panel SHALL have a History view listing the user's past chats with title, time and message count, and marking the open one. Choosing a chat MUST show its messages as they were (tool trace, provider, model, effort, attachment names) and make the next message continue it. Each row offers Rename, with Save and Cancel, and Delete, which asks first. While the agent is working the open chat cannot be switched.

#### Scenario: Reopen and continue
- **GIVEN** a past chat "what is JWT?"
- **WHEN** the user opens History, chooses it and sends "and how does it expire?"
- **THEN** the panel shows the earlier question and answer, then the new question and its answer, and History lists one chat with four messages

#### Scenario: No past chats
- **GIVEN** the user has never chatted
- **WHEN** they open History
- **THEN** the view says there are no past chats yet

#### Scenario: Rename in the list
- **WHEN** the user chooses Rename on a row, types "JWT expiry" and presses Save
- **THEN** the row shows "JWT expiry"; with Cancel or Escape the title is unchanged

#### Scenario: Delete the open chat
- **GIVEN** the open chat is listed in History
- **WHEN** the user deletes it and confirms
- **THEN** the row is gone and the panel shows an empty new chat

### Requirement: The open chat survives a reload
The panel SHALL remember in the browser which chat is open and show it again after a reload. When that chat no longer exists or belongs to another user, the panel MUST start an empty new chat without an error.

#### Scenario: Reload
- **GIVEN** the user is in a chat with two turns
- **WHEN** they reload the page
- **THEN** the panel shows the same two turns, and a new message continues that chat

#### Scenario: Remembered chat is gone
- **GIVEN** the remembered chat was deleted on another device
- **WHEN** the user reloads the page
- **THEN** the panel shows an empty new chat and no error
