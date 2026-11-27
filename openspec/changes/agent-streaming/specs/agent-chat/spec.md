## ADDED Requirements

### Requirement: The answer is streamed while it is written
The chat panel SHALL show the agent's answer while the model writes it, and each tool step as soon as it ends, instead of waiting for the whole run. The final answer, its steps and what is stored MUST be the same as without streaming. Text the model writes before a tool call MUST NOT stay in the answer. A provider that runs its own loop (Claude Code) MAY send its answer only at the end. Every check made before the run starts MUST answer the same HTTP error as the non-streamed request.

#### Scenario: Answer grows while written
- **GIVEN** a provider that streams its answer in parts
- **WHEN** the user sends a question
- **THEN** the first part of the answer is shown before the last part is sent, and at the end the full answer is shown once, with Copy and Retry

#### Scenario: Steps show while the tools run
- **GIVEN** the model calls a tool and then answers
- **WHEN** the tool call ends
- **THEN** "Used 1 tool" is shown before the answer text arrives

#### Scenario: Same result as before
- **WHEN** a streamed answer ends
- **THEN** the stored chat, read again from History, shows the same answer and steps as the panel

#### Scenario: Error during the run
- **GIVEN** the provider fails during the run
- **THEN** no partial answer stays on screen, the question shows the error with Retry, and nothing is stored

#### Scenario: Error before the run
- **GIVEN** the user is over the rate limit
- **WHEN** they send a question
- **THEN** the stream route answers 429 with the same message as before and no stream starts
