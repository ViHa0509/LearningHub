# Spec Delta

## ADDED Requirements

### Requirement: An answer cut by the output limit
When a model's answer stops because the output limit (`max_tokens`) was reached, the system SHALL NOT run the tool calls of that answer. Each such call SHALL be answered with a tool error that names the limit and asks for a shorter call or a higher `max_tokens` in the provider configuration, and the step SHALL be listed with that summary. A cut answer without tool calls SHALL be returned with a line saying it was cut. The Anthropic default `max_tokens` SHALL be 8192.

#### Scenario: Cut tool call
- **GIVEN** a provider whose answer is cut while calling `write_lesson`
- **WHEN** the lesson writer runs
- **THEN** no lesson is written from that call, the step reads "The answer was cut off by the output limit", and the model gets that message as the tool result

#### Scenario: Cut text answer
- **WHEN** the model's final text is cut by the limit
- **THEN** the reply ends with a line saying the answer was cut off by the output limit

### Requirement: A failing call is not repeated without end
When the model repeats a tool call with the same name and input that already failed with the same error, the system SHALL answer it once more and then stop the run with the stopped reply, listing the steps so far.

#### Scenario: Same failing call three times
- **GIVEN** `write_lesson` refused a call twice with the same error
- **WHEN** the model sends the same call a third time
- **THEN** the run stops with the stopped reply after at most that call, before the step budget is spent

### Requirement: Lesson writer without references
When the topic has no notes and no references, the lesson writer SHALL search the web when Internet search is on for it, read 2 to 4 trustworthy sources (official bodies, laws and regulations, textbooks, reference works) and cite them under Sources; when search is off, it SHALL write from its own knowledge and say under Sources that no source was used. It SHALL never call `write_lesson` without the full lesson text.

#### Scenario: New area with search on
- **GIVEN** the area `o-to-hang-b` has no notes and no references and Internet search is on for the lesson writer
- **WHEN** the user asks to draft `o-to-hang-b/chuong-1`
- **THEN** the writer searches the web, writes the lesson and its Sources list the pages it used

#### Scenario: New area with search off
- **GIVEN** the same area and Internet search off
- **WHEN** the user asks to draft the lesson
- **THEN** the writer writes it from its own knowledge and Sources says no source was used
