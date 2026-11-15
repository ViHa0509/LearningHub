# Spec Delta

## MODIFIED Requirements

### Requirement: Question banks in the backup
The backup SHALL include the question banks of the user's areas with their images, the user's answers with the chosen option, the user's bookmarks and their tests; restore replaces them when the archive has them and leaves them when it does not. An archive from before the chosen option and bookmarks existed restores with no choice and no bookmarks.

#### Scenario: Round trip
- **GIVEN** a bank with an image, an answer with option 2, a bookmark and one finished test
- **WHEN** the user backs up and restores into an empty account
- **THEN** the bank, its image, the answer with option 2, the bookmark and the test are back
