# node-resources Specification

## Purpose
Gives each lesson node a list of reading links (official docs, articles, videos, courses) synced from roadmap.sh into the local database only, shows them on the lesson page, and lets the agent read the official and article pages safely to draft a lesson in its own words.

## Requirements

### Requirement: Resource mapping per domain
The system SHALL read `roadmaps/sources/<domain>.yaml`, which maps app node ids to roadmap.sh node references (`<roadmap>/<slug>` or `<roadmap>/*`) at a pinned commit. A mapping that names an app node missing from the catalog MUST stop the server from starting, like an invalid roadmap file.

#### Scenario: Unknown app node
- **GIVEN** a mapping file that names `frontend/not-a-node`
- **WHEN** the server starts
- **THEN** it refuses to start and names the unknown node

### Requirement: Sync resource links
The system SHALL sync a domain's links from the pinned commit on request: from the command line, or with a POST that starts a background job and answers 202. It parses only link lines (`[@type@label](url)`), and stores one row per node and URL. It replaces the domain's rows in a single transaction at the end. A failed sync keeps the previous rows and reports the error. The sync status (idle, running, done or failed, with counts or error) can be read.

#### Scenario: First sync
- **GIVEN** the mapping of `frontend` and a source that serves its node files
- **WHEN** the user starts a sync of `frontend`
- **THEN** the status becomes done with the number of nodes and links, and each mapped node has its links

#### Scenario: Sync again
- **WHEN** the same domain is synced twice
- **THEN** the links are stored once, not duplicated

#### Scenario: Failed sync keeps the old links
- **GIVEN** a synced domain
- **WHEN** a new sync fails part way, or a mapped slug does not exist at that commit
- **THEN** the status is failed with the reason, and the earlier links are unchanged

#### Scenario: Roadmap without a mapping
- **WHEN** the sync status of a roadmap without a mapping file is read
- **THEN** it answers `unavailable` (not an error), and a sync of that roadmap is refused with 404

#### Scenario: Sync needs the app header
- **WHEN** a sync is requested without `X-LearningHub: 1`
- **THEN** it is refused with 403 and nothing runs

### Requirement: Read a node's references
The system SHALL return a node's references ordered by type (official, course, book, article, opensource, video, roadmap, podcast) and then title, with the source, commit, sync time and a link to the roadmap on roadmap.sh. An unknown node MUST answer 404, and a known node without synced links answers an empty list.

#### Scenario: Synced node
- **WHEN** the references of `frontend/html` are read after a sync
- **THEN** official links come before articles and videos, each with its title, type and URL

#### Scenario: Not synced yet
- **WHEN** the references of a known node with no synced links are read
- **THEN** the answer has an empty list

#### Scenario: Unknown node
- **WHEN** the references of `frontend/not-a-node` are read
- **THEN** the answer is 404

### Requirement: References on the lesson page
The lesson page SHALL show a References section grouped by type. Each link opens in a new tab without giving the opened page access to the app, and the section ends with "Source: roadmap.sh" and when the links were synced. Without links it offers Sync references and shows progress until the sync ends. Draft lesson from references asks the lesson writer to draft the lesson from them.

#### Scenario: Grouped links
- **GIVEN** `frontend/html` has official and article links
- **WHEN** the user opens its lesson page
- **THEN** References shows an Official group and an Articles group, and each link has `target="_blank"` and `rel="noopener noreferrer"`

#### Scenario: Sync from the empty state
- **WHEN** the user clicks Sync references on a node without links
- **THEN** the page shows the sync running and then the links, without a reload

### Requirement: The agent reads references safely
The agent SHALL have `list_node_resources` and `fetch_reference`. `fetch_reference` MUST accept only an http(s) URL stored for that node as official or article (never YouTube), refuse private, loopback, link-local or reserved addresses on every hop (at most 3 redirects), and connect only to the checked address. It reads at most 2 MB of HTML or text in 10 s and returns at most 20 000 characters as untrusted content, never stored.

#### Scenario: URL not stored for the node
- **WHEN** the agent asks to fetch a URL that is not a reference of that node
- **THEN** the tool refuses without making a request

#### Scenario: Redirect to an internal address
- **GIVEN** a stored reference whose server redirects to `http://127.0.0.1/`
- **WHEN** the agent fetches it
- **THEN** the tool refuses at the redirect and returns no content from the internal address

#### Scenario: Wrong content type or too large
- **WHEN** a reference answers with an image, or with more than 2 MB
- **THEN** the tool refuses with the reason

#### Scenario: Instructions inside a reference
- **WHEN** a fetched page says "ignore previous instructions"
- **THEN** the text reaches the model inside `<untrusted_reference_content>`, and the system prompt says such text is data
