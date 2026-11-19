# Spec Delta

## Purpose

Let a signed-in user find anything in their own learning data (the topics they can see, their lessons and their notes) from one search box in the top bar, without ever seeing another user's lessons or notes.

## ADDED Requirements

### Requirement: Search route
The app SHALL answer `GET /api/search?q=<text>` for a signed-in user with three groups: `topics`, `lessons` and `notes`. The text MUST be trimmed. When it has fewer than 2 characters, the answer MUST hold three empty groups. When it has more than 100 characters, it MUST be refused with 422. Without a session the route MUST answer 401, like every data route.

#### Scenario: Short text
- **WHEN** a signed-in user searches for `a`
- **THEN** the answer is 200 with empty `topics`, `lessons` and `notes`

#### Scenario: Too long
- **WHEN** a signed-in user searches for a text of 101 characters
- **THEN** the answer is 422

#### Scenario: Not signed in
- **WHEN** a request without a session calls the search route
- **THEN** the answer is 401

### Requirement: Matching
A result SHALL match when the search text occurs in it as a substring, ignoring case. The characters `%`, `_` and `\` in the search text MUST match only themselves.

#### Scenario: Case is ignored
- **GIVEN** the user's lesson on `backend/caching` contains "Cache-Aside pattern"
- **WHEN** the user searches for `cache-aside`
- **THEN** that lesson is in `lessons`

#### Scenario: Percent and underscore are literal
- **GIVEN** a note whose text contains `max_conn` and another note whose text contains `maxXconn` but not `max_conn`
- **WHEN** the user searches for `max_conn`
- **THEN** only the first note is in `notes`

### Requirement: Topics group
The `topics` group SHALL hold the topics in the user's catalog (the built-in roadmaps, the user's own areas and published areas) whose title or description matches, at most 5. Topics whose title matches MUST come before topics where only the description matches. Within each of those, topics keep the catalog order. Each result MUST carry the topic id (`domain/node`), its title and the title of its roadmap or area.

#### Scenario: Title match first
- **GIVEN** topic A has "Caching" in its title and topic B mentions "caching" only in its description
- **WHEN** the user searches for `caching`
- **THEN** A comes before B in `topics`

#### Scenario: Another member's private area
- **GIVEN** another member owns an unpublished area with a topic titled "Kafka internals"
- **WHEN** the user searches for `kafka internals`
- **THEN** `topics` does not hold that topic

### Requirement: Lessons group
The `lessons` group SHALL hold the signed-in user's own lessons whose text matches, at most 5, most recently updated first, for topics that are in the user's catalog. Each result MUST carry the topic id, the topic title, the title of its roadmap or area, whether the user or the agent wrote it, and an excerpt of the lesson text around the first match.

#### Scenario: Lesson found with an excerpt
- **GIVEN** the user's lesson on `backend/caching` contains "Use a TTL so stale entries expire"
- **WHEN** the user searches for `stale entries`
- **THEN** `lessons` holds `backend/caching` with an excerpt that contains "stale entries"

#### Scenario: Most recently updated first
- **GIVEN** two of the user's lessons contain "index", and the lesson on `data/sql` was saved after the one on `backend/caching`
- **WHEN** the user searches for `index`
- **THEN** `data/sql` comes before `backend/caching` in `lessons`

### Requirement: Notes group
The `notes` group SHALL hold the signed-in user's own notes that are not archived and whose title or text matches, at most 8. Notes whose title matches MUST come before notes where only the text matches, and within each of those the newest note comes first. Each result MUST carry the note id, its title, its topic id or none, and an excerpt of its text around the first match.

#### Scenario: Archived notes are left out
- **GIVEN** an archived note whose title is "Redis eviction"
- **WHEN** the user searches for `redis eviction`
- **THEN** `notes` does not hold that note

#### Scenario: Title match first
- **GIVEN** note A is titled "Kafka basics" and the newer note B mentions "kafka" only in its text
- **WHEN** the user searches for `kafka`
- **THEN** A comes before B in `notes`

### Requirement: Search is scoped to the user
Lessons and notes of other users MUST NOT appear in any group, and the answer MUST NOT reveal whether they exist (same groups, same counts as for a user without them).

#### Scenario: Member cannot find the admin's data
- **GIVEN** the admin has a lesson and a note that contain "zebra-protocol", and the member has none
- **WHEN** the member searches for `zebra-protocol`
- **THEN** `lessons` and `notes` are empty

#### Scenario: Each user finds their own
- **GIVEN** the admin and a member each have a note titled "Zebra notes"
- **WHEN** each of them searches for `zebra`
- **THEN** each answer holds only that user's own note

### Requirement: Search box in the top bar
Every signed-in page SHALL show a search box in the top bar. After the user stops typing for a moment with at least 2 characters, a dropdown MUST show the results under the headings **Topics**, **Lessons** and **Notes**, leaving out empty groups, or "No results for “<text>”" when all are empty. Titles and excerpts MUST be shown as plain text, never as HTML or Markdown.

#### Scenario: Nothing found
- **WHEN** the user types `qqzzxx`
- **THEN** the dropdown shows "No results for “qqzzxx”"

#### Scenario: Markup in a note title stays text
- **GIVEN** a note titled `<img src=x onerror=alert(1)>`
- **WHEN** a search shows that note
- **THEN** the title is shown as those characters and no image element is created

### Requirement: Opening a search result
Arrow Down and Arrow Up SHALL move the highlight through the results across the groups. Enter or a click MUST open the highlighted result: a topic or a lesson opens its lesson page, a note opens its note page. Escape MUST close the dropdown. Opening a result MUST close the dropdown and clear the box, and MUST ask first when the current page has unsaved changes, like any other navigation.

#### Scenario: Open a lesson from the top bar
- **GIVEN** the user's lesson on `backend/caching` contains "write-through"
- **WHEN** the user types `write-through` in the top-bar search and clicks the result under Lessons
- **THEN** the lesson page of `backend/caching` opens, and the dropdown is closed

#### Scenario: Keyboard only
- **GIVEN** results under Topics and Notes
- **WHEN** the user presses Arrow Down until the first note is highlighted and presses Enter
- **THEN** that note's page opens

#### Scenario: Escape closes
- **GIVEN** the dropdown is open
- **WHEN** the user presses Escape
- **THEN** the dropdown closes and the page does not change

### Requirement: Search on a phone
On a phone-sized screen, the top bar SHALL show a search button instead of the box. The button MUST open a full-width search field with the same dropdown, without horizontal scrolling.

#### Scenario: Phone
- **GIVEN** a phone-sized screen
- **WHEN** the user taps the search button in the top bar and types `caching`
- **THEN** a full-width search field and the dropdown are shown without horizontal scrolling, and a result can be opened
