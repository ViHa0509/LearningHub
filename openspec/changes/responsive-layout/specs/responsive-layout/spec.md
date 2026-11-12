## Purpose

Makes the app fit the screen it is opened on: phone, tablet and desktop widths each get a layout that needs no sideways scrolling and works by touch.

## ADDED Requirements

### Requirement: Screen classes
The app SHALL choose its layout from the viewport width: phone below 640 px, tablet from 640 to 1099 px, desktop from 1100 px. It MUST follow the width when it changes (rotation, window resize) without a reload and without losing the current page, an open note, or text typed in the chat.

#### Scenario: Rotate a tablet
- **GIVEN** the app on a tablet in landscape (1180 px wide) with a question typed in the chat
- **WHEN** the tablet is turned to portrait (820 px wide)
- **THEN** the layout becomes the tablet layout, the same page is shown and the typed question is still there

### Requirement: No sideways page scroll
At every viewport width from 360 px up, on every page of the app (home, roadmap, lesson, note, news, settings pages, sign-in pages), the page MUST NOT scroll sideways. Content that cannot shrink (domain tabs, settings tabs, the Users table) SHALL scroll inside its own area, and card grids SHALL drop to fewer columns.

#### Scenario: Phone width
- **WHEN** each page of the app is opened at 360 px wide
- **THEN** the page is no wider than the screen and every control on it can be reached without scrolling the page sideways

#### Scenario: Users table on a phone
- **WHEN** the admin opens the Users page at 390 px wide
- **THEN** the table scrolls sideways inside its own area and the rest of the page stays still

### Requirement: Side panels as drawers on a phone
On a phone the center page SHALL take the whole width, and the learned list and the agent chat SHALL open as drawers over the page from two buttons in the top bar. Only one drawer is open at a time. A drawer MUST close with its close button, with Escape and with a tap outside it, and focus MUST move into the drawer when it opens and back to its button when it closes.

#### Scenario: App opens on a phone
- **WHEN** the user opens the app at 390 px wide
- **THEN** the top bar and the home page are visible, and both drawers are closed

#### Scenario: Open a note from the list
- **GIVEN** the learned list drawer is open on a phone
- **WHEN** the user taps a note
- **THEN** the drawer closes and the note is shown in the center

#### Scenario: Ask the agent from a page
- **GIVEN** a phone with the learned list drawer open
- **WHEN** the user opens the agent drawer, or uses an action that asks the agent
- **THEN** the list drawer closes and the agent drawer is open

#### Scenario: Close with Escape
- **GIVEN** the agent drawer is open
- **WHEN** the user presses Escape
- **THEN** the drawer closes, focus returns to its top-bar button, and text typed in the chat is kept

### Requirement: One side panel at a time on a tablet
On a tablet the app SHALL show the center page with at most one side panel open next to it: the learned list starts open and the agent chat starts collapsed, and opening one collapses the other.

#### Scenario: Open the chat on a tablet
- **GIVEN** the app at 820 px wide with the learned list open
- **WHEN** the user opens the agent chat
- **THEN** the list collapses, the chat is open, and the center keeps at least half of the width

### Requirement: Compact top bar
The top bar SHALL fit the width without wrapping or overflowing. On a phone it shows the logo mark, News as an icon, one theme button that steps through System, Light and Dark, the two drawer buttons and the avatar; on a tablet the theme switch shows icons only. Every icon-only control MUST keep an accessible name.

#### Scenario: Change the theme on a phone
- **GIVEN** the app on a phone with the System theme
- **WHEN** the user taps the theme button
- **THEN** the theme becomes Light and the button's accessible name says so; two more taps give Dark, then System

#### Scenario: Top bar at 360 px
- **WHEN** a signed-in user opens the app at 360 px wide
- **THEN** every top-bar control is fully visible on one row

### Requirement: Full visible height
The app SHALL fill the visible height of the browser window, including on mobile browsers whose bars change size, so that the bottom of the page and the chat composer are never hidden behind browser controls.

#### Scenario: Composer on a phone
- **WHEN** the user opens the agent drawer on a phone
- **THEN** the composer and its Send button are fully visible above the bottom of the screen

### Requirement: Roadmap map on small screens
On a phone or tablet the roadmap map SHALL open with the first node of the roadmap in view at a size whose labels can be read, and it MUST move by drag and zoom by pinch and by its controls.

#### Scenario: Open a roadmap on a phone
- **WHEN** the user opens the Frontend roadmap at 390 px wide
- **THEN** the roadmap's first node is visible with a readable label, and dragging the map shows the nodes below

### Requirement: Touch use
On touch screens every action MUST be reachable without hovering: controls that appear only on hover on a desktop (such as a note's More actions) are always shown. Controls in the top bar, the learned list, the panel headers and the chat composer SHALL be at least 40 px tall on a phone or tablet.

#### Scenario: More actions without hover
- **GIVEN** the learned list on a phone
- **WHEN** the list is shown
- **THEN** each note's More actions button is visible and opens its menu with one tap

#### Scenario: Target size
- **WHEN** the top bar, a list row and the Send button are measured at 390 px wide
- **THEN** each is at least 40 px tall
