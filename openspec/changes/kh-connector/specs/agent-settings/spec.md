## MODIFIED Requirements

### Requirement: Tools per area
For every domain the user can see, the user SHALL be able to choose which of the app's tools the agents may use on that area (all by default). A tool that is not chosen MUST NOT be offered to the model on that area's pages, on every provider type, and a call to it is refused. Clients MUST be able to list the app's tools with a description and the agents that have them. When the Knowledge Hub connector is available on the server, the list includes `kh_search`.

#### Scenario: List the tools
- **WHEN** a client lists the agent tools
- **THEN** it receives `search_notes`, `read_note`, `list_roadmap`, `read_lesson`, `write_lesson`, `list_node_resources`, `fetch_reference`, `save_learned_note` (Learning assistant only) and `propose_topics` (Topic outline only), each with a description

#### Scenario: List the tools with the Knowledge Hub connector
- **GIVEN** a server where the Knowledge Hub connector is available
- **WHEN** a client lists the agent tools
- **THEN** the list also holds `kh_search` with a description

#### Scenario: Tool off on the area
- **GIVEN** `write_lesson` is unticked for `backend`
- **WHEN** the user chats from the lesson page of `backend/caching`
- **THEN** the model is offered every tool but `write_lesson`, and a `write_lesson` call is refused as not available

#### Scenario: Tool off on one area only
- **GIVEN** `write_lesson` is unticked for `backend`
- **WHEN** the user chats from the lesson page of `devops/docker`
- **THEN** the model is offered `write_lesson`

#### Scenario: Knowledge Hub search off on the area
- **GIVEN** a connected user who unticked `kh_search` for `backend`
- **WHEN** the user chats from the lesson page of `backend/caching`
- **THEN** the model is not offered `kh_search`
