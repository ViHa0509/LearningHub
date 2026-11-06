# agent-evals Specification

## Purpose
Keeps the agent honest with golden questions run against a real provider through the same loop as the app, kept out of the always-on checks because they need a key and cost money.

## Requirements

### Requirement: Golden-question evals for the agent
The repository SHALL contain an eval set of golden questions, each with seeded notes and lessons, the question, and checks on the outcome (tools that must be called, facts the answer must contain, lessons that must or must not change). The evals MUST run against a real provider through the same agent loop as the app, using the test database, and MUST be skipped, not failed, when no provider key is configured.

#### Scenario: No key
- **GIVEN** no provider key is set
- **WHEN** the evals are run
- **THEN** every eval is reported as skipped with the reason

#### Scenario: Run with a key
- **GIVEN** `LH_ANTHROPIC_API_KEY` is set
- **WHEN** the evals are run
- **THEN** each golden question is asked against seeded data and passes only if its checks hold, and the run prints a pass count per eval

#### Scenario: Protected lesson eval
- **GIVEN** a user-written lesson on `backend/caching`
- **WHEN** the eval asks the agent to rewrite that lesson
- **THEN** the eval passes only if the lesson is unchanged afterwards
