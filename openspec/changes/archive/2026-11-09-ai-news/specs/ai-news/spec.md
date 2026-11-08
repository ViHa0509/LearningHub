## ADDED Requirements

### Requirement: News sources are configured in one file
The system SHALL read the news sources from `news/sources.yaml` (id, name, homepage, feed URL over https). An invalid file MUST stop the server from starting and name the problem.

#### Scenario: Invalid source
- **GIVEN** a source with an http (not https) feed URL or a duplicate id
- **WHEN** the server starts
- **THEN** it refuses to start and names the source

### Requirement: Refresh the news
The system SHALL refresh on request (a background job answering 202) and when the News page opens after an hour without refresh. Feeds are read like references (global addresses on every hop, checked connection, 2 MB, 10 s), only as RSS/Atom/XML, refusing DTDs and entities. One failing source MUST NOT stop the others and the status names it with the reason. Items are stored once per URL and removed after 90 days.

#### Scenario: Refresh with one failing source
- **GIVEN** two sources, one answering a valid RSS feed and one answering 500
- **WHEN** the user refreshes
- **THEN** the items of the first source are stored, and the status says the second failed and why

#### Scenario: Refresh twice
- **WHEN** the same feed is read twice
- **THEN** each item is stored once

#### Scenario: Unsafe feed
- **WHEN** a feed redirects to a private address or declares an entity
- **THEN** that source fails with the reason and nothing from it is stored

#### Scenario: Refresh needs the app header
- **WHEN** a refresh is requested without `X-LearningHub: 1`
- **THEN** it is refused with 403

### Requirement: Read the news
The system SHALL list items newest first with source, title, URL, publication time and a plain-text summary of at most 400 characters taken from the feed, filtered by source and text, with paging, and the sources with their last fetch result. Full article text is never stored.

#### Scenario: Filter by source and text
- **WHEN** the client asks for source `mit-news` and the text `robot`
- **THEN** only MIT News items whose title or summary contains `robot` are returned, newest first

#### Scenario: Summary is plain text
- **GIVEN** a feed description with HTML tags and a script
- **WHEN** the item is read
- **THEN** its summary has the text only, without tags or script, at most 400 characters

### Requirement: News page
The app SHALL have a News page, reached from the top bar, that shows items grouped by day with source filter chips and a text filter. Each title opens the original article in a new tab without access to the app. Each item offers Ask the agent, which puts the title and URL in the chat. Refresh shows progress and the sources that failed; with no items yet the page offers Refresh.

#### Scenario: Read and open
- **GIVEN** stored items from two sources
- **WHEN** the user opens the News page
- **THEN** items appear newest first under day headings, and each title link has `target="_blank"` and `rel="noopener noreferrer"`

#### Scenario: Ask the agent
- **WHEN** the user clicks Ask the agent on an item
- **THEN** the chat input holds "Explain this news for me" with the item's title and URL, ready to send

#### Scenario: First visit
- **GIVEN** no items are stored
- **WHEN** the user opens the News page
- **THEN** a refresh starts by itself, its progress is shown, and the items appear without a reload
