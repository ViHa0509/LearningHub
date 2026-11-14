# Spec Delta

## ADDED Requirements

### Requirement: Question banks in the backup
The backup SHALL include the question banks of the user's areas with their images, and the user's answers and tests; restore replaces them when the archive has them and leaves them when it does not.

#### Scenario: Round trip
- **GIVEN** a bank with an image and one finished test
- **WHEN** the user backs up and restores into an empty account
- **THEN** the bank, its image and the test are back
