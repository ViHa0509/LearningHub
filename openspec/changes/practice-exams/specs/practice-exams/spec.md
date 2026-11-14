# Spec Delta

## ADDED Requirements

### Requirement: Import a question bank
The owner of an area SHALL be able to import a question bank from a JSON file or a zip holding the JSON and its images. The whole file MUST be checked before anything is stored; a bank with an error is refused with the question number and the problem.

#### Scenario: Import
- **GIVEN** an area `driving-b` with the topics `chuong-1` to `chuong-6`
- **WHEN** the owner imports a valid bank of 12 questions with two images
- **THEN** the area has the bank with 12 questions, and the images show in practice

#### Scenario: Invalid bank
- **WHEN** the file has a question whose answer is 5 with only 4 options, or a topic the area does not have
- **THEN** the import is refused naming that question, and nothing is stored

### Requirement: Practice by topic
The user SHALL be able to practise a topic, the critical questions or the questions they got wrong, one question at a time; choosing an option shows whether it is right, the correct option and the explanation, and records the result.

#### Scenario: Answer a question
- **WHEN** the user picks a wrong option in practice
- **THEN** the app marks it wrong, shows the correct option and the explanation, and the question appears in "Got wrong"

### Requirement: Mock exam by the bank's rules
"Start a test" SHALL draw questions on the server by the bank's rules (count, per-topic counts, minimum critical questions), in random order, and show a countdown. Correct answers MUST NOT reach the browser before the test is submitted. Submitting, or the time running out, scores the test: passed when the correct count reaches the pass mark and, if the bank's rules say so, no critical question is wrong.

#### Scenario: Pass
- **GIVEN** a bank whose rules are 10 questions, pass mark 8, critical questions fail the test
- **WHEN** the user answers 9 right and every critical question right
- **THEN** the result is passed with 9/10

#### Scenario: Fail on a critical question
- **WHEN** the user answers every question right except one critical question, and the rules say critical questions fail the test
- **THEN** the result is failed, naming the critical question

#### Scenario: Time out
- **WHEN** the countdown ends before the user submits
- **THEN** the test is scored with the answers given and unanswered questions count as wrong

#### Scenario: Draw follows the rules
- **GIVEN** rules with 10 questions, 3 from `chuong-1` and at least 1 critical
- **WHEN** a test is started
- **THEN** it holds 10 different questions, 3 of them from `chuong-1` and at least one critical, and no answers

### Requirement: Test history and access
The user SHALL see their past tests with date, score and result, and review any of them. Banks are visible to whoever sees the area; answers and tests are each user's own.

#### Scenario: Another user's test
- **WHEN** a user opens another user's test by its id
- **THEN** it answers not found
