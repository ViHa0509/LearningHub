# agent-settings Specification

## Purpose
Lets each user shape how the agents work on each learning area: a Settings page for the agents, and per-area extra instructions and allowed tools.

## ADDED Requirements

### Requirement: Agents page in Settings
Settings SHALL have an Agents page at `#/settings/agents`, listed in the Settings nav for every member. The page shows the agent cards (primary and fallback provider, Internet search, each saved with the card's Save) and an Areas section; the AI providers page shows the providers only.

#### Scenario: Open the Agents page
- **WHEN** the user opens Settings and chooses Agents
- **THEN** the Agents page shows the Learning assistant, Lesson writer and Topic outline cards and the Areas section

#### Scenario: Providers page shows no agent cards
- **WHEN** the user opens the AI providers page
- **THEN** no agent card is shown there

### Requirement: Extra instructions per area
For every domain the user can see (built-in roles and learning areas), the user SHALL be able to save extra instructions of at most 4000 characters, with Save and Cancel, and clear them again. The agents MUST follow those instructions on the pages of that area (its roadmap, its lesson pages, and the page of a note linked to one of its topics) and MUST NOT see them elsewhere. They never override the rules that protect user lessons and treat note content as data.

#### Scenario: Instructions reach the agent on the area
- **GIVEN** the user saved "Answer in Vietnamese and cite the article of the law" for `o-to-hang-b`
- **WHEN** the user chats from the lesson page of `o-to-hang-b/chuong-1`
- **THEN** the model's system prompt contains that text under the heading for the area

#### Scenario: Instructions stay on their area
- **GIVEN** instructions saved for `o-to-hang-b`
- **WHEN** the user chats from the home page or from the Backend roadmap
- **THEN** the system prompt contains no area instructions

#### Scenario: Note linked to the area
- **GIVEN** instructions saved for `backend` and a note linked to `backend/caching`
- **WHEN** the user chats from that note's page
- **THEN** the system prompt contains the Backend instructions

#### Scenario: Too long
- **WHEN** the user saves 4001 characters
- **THEN** the request is refused and the page says the limit

#### Scenario: Save and Cancel
- **WHEN** the user edits the instructions of an area
- **THEN** Save becomes enabled and Cancel restores the saved text; nothing is saved until Save

### Requirement: Tools per area
For every domain the user can see, the user SHALL be able to choose which of the app's tools the agents may use on that area (all by default). A tool that is not chosen MUST NOT be offered to the model on that area's pages, on every provider type, and a call to it is refused. Clients MUST be able to list the app's tools with a description and the agents that have them.

#### Scenario: List the tools
- **WHEN** a client lists the agent tools
- **THEN** it receives `search_notes`, `read_note`, `list_roadmap`, `read_lesson`, `write_lesson`, `list_node_resources`, `fetch_reference`, `save_learned_note` (Learning assistant only) and `propose_topics` (Topic outline only), each with a description

#### Scenario: Tool off on the area
- **GIVEN** `write_lesson` is unticked for `backend`
- **WHEN** the user chats from the lesson page of `backend/caching`
- **THEN** the model is offered every tool but `write_lesson`, and a `write_lesson` call is refused as not available

#### Scenario: Tool off on one area only
- **GIVEN** `write_lesson` is unticked for `backend`
- **WHEN** the user chats from the lesson page of `devops/docker`
- **THEN** the model is offered `write_lesson`

#### Scenario: Claude Code provider
- **GIVEN** `search_notes` is unticked for `backend` and the assistant runs on a Claude Code provider
- **WHEN** the user chats from the Backend roadmap
- **THEN** the MCP server started for that chat lists no `search_notes` tool

#### Scenario: Unknown tool name
- **WHEN** a client saves the tools of an area with a name that is not a tool
- **THEN** the request is refused and nothing changes

### Requirement: Area settings are the user's own data
Area settings SHALL be stored per user and per domain, visible only to their user, and answer 404 for a domain the user cannot see. They MUST be in the backup archive and restored with it; an archive from before this capability restores without them.

#### Scenario: Another user's area
- **WHEN** a user saves settings for an area that belongs to another user's private field
- **THEN** the answer is 404 and nothing is stored

#### Scenario: Round trip
- **GIVEN** instructions and a tool choice saved for `backend`
- **WHEN** the user backs up and restores the archive
- **THEN** the Backend settings are the same as before
