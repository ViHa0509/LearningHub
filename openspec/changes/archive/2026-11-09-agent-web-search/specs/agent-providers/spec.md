## ADDED Requirements

### Requirement: Internet search per agent
Each agent SHALL have an Internet search setting, off by default and saved with its card's Save. When on and the agent runs on a Claude Code provider, it MAY use Claude Code's WebSearch only (WebFetch and other built-in tools stay off); searches appear in the trace, answers list the URLs used, and results are data. For other provider types the setting MUST say it needs a Claude Code provider.

#### Scenario: Off by default
- **GIVEN** a Claude Code provider assigned to the assistant
- **WHEN** the user chats without changing the setting
- **THEN** the CLI runs with no built-in tools

#### Scenario: Search when enabled
- **GIVEN** Internet search is on for the assistant and its provider is Claude Code
- **WHEN** the agent searches the web while answering
- **THEN** the CLI was started with only WebSearch as a built-in tool, the trace shows "Searched the web for" and the query, and the answer is shown

#### Scenario: Not a Claude Code provider
- **GIVEN** the assistant's provider is an OpenAI configuration
- **WHEN** the user opens Settings → Agents
- **THEN** the Internet search setting says it needs a Claude Code provider

#### Scenario: Setting needs Save and the app header
- **WHEN** the user switches Internet search on without clicking Save, or a client changes it without `X-LearningHub: 1`
- **THEN** the stored setting is unchanged
