# Spec Delta

## ADDED Requirements

### Requirement: The catalog a user sees
The domains a user can list, read, link notes to, write lessons on and ask the agent about SHALL be the built-in roadmaps plus the areas of the user's own fields and of published fields. Areas of other users' private fields MUST behave as unknown domains.

#### Scenario: Own area is a domain
- **GIVEN** the user's area `aws` with the topic `iam`
- **WHEN** the user links a note to `aws/iam` and opens `#/lesson/aws/iam`
- **THEN** the note is linked and the lesson page shows the topic

#### Scenario: Another user's area is unknown
- **WHEN** another user links a note to `aws/iam` of a private field
- **THEN** it is refused as an unknown node
