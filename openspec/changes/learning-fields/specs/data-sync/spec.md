# Spec Delta

## ADDED Requirements

### Requirement: Fields in the backup
The backup SHALL include the user's fields with their areas and topics; restore replaces them when the archive has them and leaves them as they are when it does not. A restored area whose slug is now used by another user's area MUST stop the restore with a message, changing nothing.

#### Scenario: Round trip
- **GIVEN** the user's field "Cloud" with area `aws` and two topics
- **WHEN** the user backs up, deletes the field and restores
- **THEN** the field, area and topics are back
