# Spec Delta

## Purpose

Lets the learning assistant answer "quiz me", "practice" and "teach me" requests with an interactive A2UI surface in the chat. An A2UI agent fills structured content, the server builds the UI from its own templates and keeps the answer keys, and the user answers in place with server-side grading.

## ADDED Requirements

### Requirement: The Interactive tutor agent
The system SHALL define an agent `a2ui` ("Interactive tutor") in code, with its own primary and fallback provider in Settings > Agents. It produces content only by calling its content tools (a quiz or a lesson) with a fixed schema. It MUST NOT write layout, HTML or A2UI messages; the server builds every surface.

#### Scenario: Listed with the agents
- **WHEN** a client lists the agents
- **THEN** the list includes `a2ui` "Interactive tutor" with its primary and fallback provider or none

#### Scenario: Text instead of content
- **WHEN** the `a2ui` agent ends its run with text and no valid content tool call
- **THEN** no surface is made, and the assistant's tool result says the interactive content could not be made

### Requirement: The assistant hands interactive requests over
The assistant SHALL be offered a tool `show_interactive` with a kind (`quiz`, `practice` or `lesson`), a topic and an optional node id and question count. Its instructions MUST tell it to use the tool when the user asks to be quizzed, to practise, or for an interactive or creative lesson. The tool follows the area's tool settings like any other tool. Its result to the model names the surface and its size, never the answers.

#### Scenario: Quiz me
- **GIVEN** the user is on the lesson page of `devops/docker` and has notes about Docker
- **WHEN** they send "quiz me on docker networking"
- **THEN** the answer holds the assistant's text and one quiz surface with the generated questions

#### Scenario: Tool turned off for the area
- **GIVEN** the area's tool settings leave out `show_interactive`
- **WHEN** the user asks to be quizzed
- **THEN** the tool is not offered and the assistant answers in text

#### Scenario: No answers in the tool result
- **WHEN** `show_interactive` makes a quiz
- **THEN** the tool result given to the assistant model holds the surface kind, title and question count, and no option index or explanation

### Requirement: Practice from the question bank
When the kind is `practice` and the area of the page has a question bank the user can see, the system SHALL draw the questions from that bank with no model call. Questions on the current topic come first, then other topics. The count defaults to 5, with at most 10. A question's picture is shown from the app's own question image address.

#### Scenario: Area with a bank
- **GIVEN** the area has a bank with 40 questions, 6 of them on the current topic
- **WHEN** the assistant calls `show_interactive` with kind `practice` and count 5
- **THEN** the surface holds 5 bank questions on the current topic, and no model call is made for them

#### Scenario: Area without a bank
- **GIVEN** the area has no question bank
- **WHEN** the assistant calls `show_interactive` with kind `practice`
- **THEN** the questions are generated as for a quiz

### Requirement: Generated quiz
For a quiz, or practice without a bank, the system SHALL run the `a2ui` agent with read access to the user's notes, lessons and roadmap. It fills a quiz of 3 to 10 questions, each with 2 to 6 options, one correct option and a short explanation. Content outside these limits MUST be refused with the reason, so the agent can fix it. The agent has at most 6 steps.

#### Scenario: Invalid quiz content
- **WHEN** the agent sends a question with one option, or a correct option number out of range
- **THEN** the tool refuses it with the reason and the agent may send it again within its steps

#### Scenario: The agent fails
- **WHEN** the agent's provider fails or the step budget runs out without valid content
- **THEN** no surface is made, the assistant's tool result says why, and the assistant answers in text

### Requirement: Creative lesson
For a lesson, the system SHALL run the `a2ui` agent to fill a lesson of a title and 3 to 8 sections. Each section is a concept, an example, a tip or a check-yourself question. A check-yourself question has the same shape and limits as a quiz question and is graded the same way. Section text is Markdown.

#### Scenario: Lesson with a check
- **WHEN** the agent fills a lesson with two concepts, an example and one check-yourself question
- **THEN** the surface shows the four sections in order, and the check-yourself question can be answered and graded

### Requirement: Surfaces come from templates and carry no answers
The system SHALL build each surface as A2UI v0.9 messages for the basic catalog from app-owned templates. The messages sent to the browser MUST NOT contain a correct option or an explanation before that question is answered. The answer key is stored on the server with the surface, owned by the user.

#### Scenario: Inspect the chat answer
- **WHEN** a quiz surface arrives in a chat answer
- **THEN** its messages hold the questions and options, and no correct option number or explanation

### Requirement: Grade an answer
The system SHALL accept an A2UI `action` named `check_answer` for a surface with the question id and the chosen option. It grades the answer against the stored key with no model call and answers with `updateDataModel` messages: right or wrong, the correct option, the explanation, and the score so far. A question is graded once; a later action returns the first result. Another user's surface answers 404. The route needs the `X-LearningHub: 1` header.

#### Scenario: Right answer
- **WHEN** the user picks the correct option and presses Check
- **THEN** the question shows "Correct" with the explanation, and the score goes up by one

#### Scenario: Wrong answer
- **WHEN** the user picks a wrong option and presses Check
- **THEN** the question shows "Not quite", marks the correct option and shows the explanation

#### Scenario: Answer twice
- **WHEN** an action for a question that was already graded arrives with another option
- **THEN** the first result is returned and the score does not change

#### Scenario: Someone else's surface
- **WHEN** a user sends an action for a surface of another user
- **THEN** the answer is 404

#### Scenario: Unknown action or question
- **WHEN** an action has another name, an unknown question id or an option out of range
- **THEN** the answer is 400 with the reason and nothing is recorded

### Requirement: Bank answers count as practice
An answer to a bank question in a chat surface SHALL be recorded in the user's practice history as an answer from the Practice page is, so it counts for the wrong-questions list.

#### Scenario: Wrong bank answer
- **WHEN** the user answers a bank question wrong in the chat
- **THEN** that question is in the area's wrong-questions practice afterwards

### Requirement: Surfaces in the chat panel
The chat panel SHALL show each surface under the assistant's text, rendered with the same renderer, catalog, media rules and Markdown rules as the A2UI Lab, in the app's light and dark theme. A surface that cannot be rendered shows a short error in its place. The rest of the answer still shows.

#### Scenario: Answer in the panel
- **WHEN** a quiz answer arrives
- **THEN** the panel shows the text, then the quiz with its questions, options and a Check button per question

#### Scenario: Dark theme
- **GIVEN** the app theme is dark
- **WHEN** a quiz surface is shown
- **THEN** it uses the app's dark colors and its text is readable

### Requirement: Stored chats keep their surfaces
A surface SHALL be stored with the assistant message it came with. Reopening a stored chat MUST show it with the answers already given, their results and the score. Retrying from an earlier message or deleting the chat removes its surfaces. The data backup does not include surfaces; a restored chat shows the answer text only.

#### Scenario: Reopen a chat
- **GIVEN** the user answered 2 of 5 quiz questions
- **WHEN** they reopen the chat from the history
- **THEN** the quiz shows those 2 results and the score, and the other 3 can still be answered

### Requirement: One request, one count
A chat request that makes a surface SHALL use one per-minute rate-limit slot and, in shared mode, one daily count, like any chat request; the `a2ui` agent's run does not take another. A grading action calls no model and takes neither. When the `a2ui` agent's provider is of type `claude-code`, `show_interactive` returns an error saying that type is not supported for it.

#### Scenario: Shared mode count
- **GIVEN** a member in shared mode with a daily limit of 20 who has used 3
- **WHEN** they ask for a quiz and then answer all of its questions
- **THEN** their use for the day is 4

### Requirement: Untrusted text stays text
Note and lesson text SHALL reach the `a2ui` agent only inside the untrusted-content markers, as for the assistant. Content text is shown only as text or Markdown with the app's rules: no raw HTML, no script links, and no images from outside the app. The content schemas have no URL or image fields.

#### Scenario: Injected markup in a question
- **WHEN** a generated question's text holds `<img src=x onerror=alert(1)>` and `![x](https://tracker.example/p.png)`
- **THEN** no element is created from the HTML, no request goes to `tracker.example`, and the text is shown as text
