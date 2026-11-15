# Spec Delta

## MODIFIED Requirements

### Requirement: Practice by topic
The practice page SHALL show the bank's sets as tabs (All, each topic in the bank's order, Critical, Got wrong, Bookmarked) and, for the chosen set, a grid with the number of every question in it and one question card. Each number SHALL show the user's state: green when the last answer was right, yellow when it was wrong, plain when not answered; a critical question carries a red mark in every state; the current question is outlined. Choosing a number opens that question. The card SHALL offer Bookmark, Shuffle, Previous, Next and Check. Choosing an option and Check shows whether it is right, the correct option and the explanation, records the result with the chosen option, and updates the grid at once.

#### Scenario: Answer a question
- **WHEN** the user picks a wrong option in practice and presses Check
- **THEN** the app marks it wrong, shows the correct option and the explanation, the question's number turns yellow in the grid, and the question appears in "Got wrong"

#### Scenario: Colours of the grid
- **GIVEN** question 3 was answered right, question 5 wrong, question 7 is critical and not answered
- **WHEN** the user opens the set All
- **THEN** number 3 is green, 5 is yellow, 7 is plain with the red critical mark, and the others are plain

#### Scenario: Shuffle
- **GIVEN** the set Chương 1 with 12 questions
- **WHEN** the user presses Shuffle
- **THEN** the set is shown in a new random order starting at its first question, every question appears once, and the grid still shows the bank numbers

## ADDED Requirements

### Requirement: Saved answers
The system SHALL keep, per user and question, the last chosen option with whether it was right. A question answered before SHALL open with that option selected and marked right or wrong, on any device; the user can answer again, and the latest answer replaces the earlier one.

#### Scenario: Come back to an answered question
- **GIVEN** the user answered question 4 with option 2, which was wrong
- **WHEN** they open question 4 again later in another browser
- **THEN** option 2 is selected and marked wrong, and Check is available for a new answer

#### Scenario: Answer again
- **GIVEN** question 4 was answered wrong
- **WHEN** the user picks the right option and presses Check
- **THEN** the grid shows 4 green and the question leaves "Got wrong"

### Requirement: Bookmarks
The user SHALL be able to bookmark a question and remove the bookmark; bookmarks are the user's own, listed in the Bookmarked set, counted on its tab and kept in the backup.

#### Scenario: Bookmark and unbookmark
- **WHEN** the user bookmarks question 9 and then opens the Bookmarked set
- **THEN** the set holds question 9; removing the bookmark empties the set

#### Scenario: Another user's bookmark
- **GIVEN** user A bookmarked question 9 of a published bank
- **WHEN** user B opens the Bookmarked set of that bank
- **THEN** it is empty, and B bookmarking question 9 does not change A's list

### Requirement: Practice entry on the area page
The area page of a learning-field area SHALL always show Practice. Without a bank the practice page SHALL say the area has no question banks yet and, for the area's owner, offer Import questions there with the same checks and messages as on the area page.

#### Scenario: Area without a bank
- **GIVEN** the owner's area `driving-b` has no bank
- **WHEN** the owner opens Practice from the area page
- **THEN** the page says there are no question banks yet and offers Import questions; a member who can see the area sees the message without the import
