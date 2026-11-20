## ADDED Requirements

### Requirement: Chat pet shows the agent's state
The chat panel SHALL show a small pet on the composer with a state taken from the chat: idle, thinking while a request runs, done when an answer arrives, error when a request fails. Done and error return to idle after a few seconds. A speech bubble shows one fixed line for the greeting at app start and for thinking, done and error, and goes away by itself.

#### Scenario: Greeting
- **WHEN** the user opens the app with the pet on
- **THEN** the pet is idle on the composer and its bubble shows the greeting, which goes away after a few seconds

#### Scenario: Thinking
- **WHEN** the user sends a message
- **THEN** the pet is in its thinking state with the thinking line until the request ends

#### Scenario: Done
- **WHEN** the answer arrives
- **THEN** the pet shows its done state and line, then returns to idle with no bubble

#### Scenario: Error
- **WHEN** the chat request fails
- **THEN** the pet shows its error state and line, then returns to idle, and the panel's own error row with Retry is unchanged

### Requirement: Pet text is fixed
The pet's bubble MUST show only lines written in the app. It MUST NOT show text from a model answer, a note, a lesson, an error message of the server or anything the user typed.

#### Scenario: Answer text stays out of the bubble
- **WHEN** an answer or an error message arrives
- **THEN** the bubble shows the fixed done or error line and none of the answer's or the error's text

### Requirement: Pet can be switched off
The composer's options menu SHALL have a Pet item that switches the pet on or off at once. The choice is kept in the browser and the pet is on until the user switches it off. With storage blocked the choice lasts for the page.

#### Scenario: Switch off
- **WHEN** the user opens the options menu and switches Pet off
- **THEN** the pet and its bubble are gone, and stay gone after a reload

#### Scenario: Switch on again
- **GIVEN** the pet is off
- **WHEN** the user switches Pet on in the options menu
- **THEN** the pet is back on the composer

### Requirement: Pet never gets in the way
The pet SHALL be decoration only: it takes no click or focus, covers no control or message text, and is hidden from assistive technology. It MUST NOT animate when the system asks for reduced motion, MUST use the theme's colors, and is not shown at phone size.

#### Scenario: Controls stay usable
- **WHEN** the pet and its bubble are shown and the user clicks Send, the options button or a message under the pet
- **THEN** the click reaches that control or message

#### Scenario: Last message stays readable
- **WHEN** the conversation is scrolled to its end with the pet shown
- **THEN** the pet does not cover the text of the last message

#### Scenario: Reduced motion
- **GIVEN** the system asks for reduced motion
- **WHEN** the pet changes state
- **THEN** it shows the new state as a still picture and the bubble appears without animation

#### Scenario: Phone
- **WHEN** the app is open at phone size
- **THEN** no pet is shown and the composer is as before

#### Scenario: Dark theme
- **WHEN** the user switches to the dark theme
- **THEN** the pet and its bubble use the dark theme's colors
