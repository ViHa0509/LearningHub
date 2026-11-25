## ADDED Requirements

### Requirement: Tools page under Agents
Settings SHALL have a Tools page at `#/settings/agents/tools`, shown in the Settings nav as a child item under Agents, for every member. It MUST show one card for each agent that uses tools: Learning assistant, Lesson writer, Topic outline and Interactive tutor.

#### Scenario: Open the Tools page
- **WHEN** the user opens Settings and chooses Tools under Agents
- **THEN** the page shows the four agent cards, each listing its attached tools with a short description

### Requirement: Add and remove an agent's tools
On each agent card the user SHALL be able to remove an attached tool and add one from a dropdown that lists only that agent's own tools not yet attached. Changes MUST be kept only after Save; Save is disabled until the list differs from the saved one, and Cancel restores it. All of an agent's own tools are attached by default.

#### Scenario: Remove and save
- **WHEN** the user removes `write_lesson` from the Learning assistant and clicks Save
- **THEN** after a reload the assistant's card no longer lists `write_lesson` and the dropdown offers it

#### Scenario: Add back
- **GIVEN** `write_lesson` was removed from the Learning assistant
- **WHEN** the user picks it in the Add tool dropdown, adds it and saves
- **THEN** the card lists it again

#### Scenario: Only the agent's own tools
- **WHEN** the user opens the Add tool dropdown of the Lesson writer
- **THEN** it never offers `save_learned_note` or `propose_topics`, and saving a tool that is not the agent's own is refused

#### Scenario: Cancel
- **WHEN** the user removes a tool and clicks Cancel
- **THEN** the card shows the saved list and nothing is stored

### Requirement: A removed tool is not offered
A tool removed from an agent MUST NOT be offered to that agent's model on any page and any provider type, and a call to it MUST be refused as not available. A tool is offered only when the agent has it attached and the area's tool ticks allow it.

#### Scenario: Removed from the assistant
- **GIVEN** `search_notes` is removed from the Learning assistant
- **WHEN** the user chats from the home page
- **THEN** the model is offered no `search_notes`, and the Lesson writer is still offered it

#### Scenario: Both layers
- **GIVEN** `write_lesson` is attached to the assistant but unticked for `backend`
- **WHEN** the user chats from a Backend lesson page
- **THEN** the model is offered no `write_lesson`

#### Scenario: Claude Code provider
- **GIVEN** `read_note` is removed from the Learning assistant, which runs on a Claude Code provider
- **WHEN** the user chats
- **THEN** the MCP server started for that chat lists no `read_note` tool

#### Scenario: Interactive tutor keeps its output
- **GIVEN** every listed tool is removed from the Interactive tutor
- **WHEN** the user asks the assistant for a quiz
- **THEN** the tutor still draws the quiz, without reading notes

### Requirement: Connections page under Agents
Settings SHALL have a Connections page at `#/settings/agents/connections`, shown in the Settings nav as a child item under Agents after Tools, for every member. It MUST hold the external connections the agents use, today the Knowledge Hub card (connect, status, disconnect), which MUST no longer be shown on the Agents page. Every link that asks the user to connect or reconnect Knowledge Hub MUST open this page.

#### Scenario: Knowledge Hub on Connections
- **WHEN** the user opens Connections under Agents
- **THEN** the Knowledge Hub card is shown there, and the Agents page has no Knowledge Hub card

#### Scenario: Reconnect notice opens Connections
- **GIVEN** the user has a "Knowledge Hub needs reconnecting" notification
- **WHEN** they click it
- **THEN** the Connections page opens

### Requirement: Agent tool choices are the user's own data
Each user's tool choices SHALL be stored per user and agent and be in the backup archive; an archive without them restores with every tool attached.

#### Scenario: Another user
- **GIVEN** user A removed `write_lesson` from the assistant
- **WHEN** user B chats
- **THEN** B's assistant is offered `write_lesson`

#### Scenario: Round trip
- **GIVEN** a removed tool
- **WHEN** the user backs up and restores
- **THEN** the tool is still removed
