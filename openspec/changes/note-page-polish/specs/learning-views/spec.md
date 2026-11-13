# Spec Delta

## ADDED Requirements

### Requirement: Note page header and page loading
The note page header SHALL keep the Back button and the More actions button on its first line at every window width, with More actions at the right end; the title field and the node picker shrink before the header wraps. The delete confirmation MUST be shown under the header, not inside its row. While the stored page of a note is loading, the page area MUST keep the app's background and show a loading indicator instead of an empty white frame; the indicator goes away when the page has loaded.

#### Scenario: Header on a laptop-size window
- **GIVEN** a window 1280 px wide with both side panels open
- **WHEN** the user opens a note
- **THEN** Back, the title field, the node picker and More actions are on one line, and More actions is at the right end of the header

#### Scenario: Header on a phone
- **GIVEN** a window 390 px wide
- **WHEN** the user opens a note
- **THEN** Back and More actions are on the header's first line, More actions at the right end, and the page does not scroll sideways

#### Scenario: Delete confirmation under the header
- **WHEN** the user chooses Delete in the More actions menu
- **THEN** the confirmation appears under the header and More actions stays on the header's first line

#### Scenario: Loading indicator
- **GIVEN** the stored page of a note takes time to load
- **WHEN** the user opens the note
- **THEN** the page area shows "Loading page…" with a spinner on the app's background, and no white frame
- **AND** when the page has loaded the indicator is gone and the page is shown
