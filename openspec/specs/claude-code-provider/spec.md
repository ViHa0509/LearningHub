# claude-code-provider Specification

## Purpose
Lets the agent run on the owner's Claude subscription by driving the installed Claude Code CLI in an isolated, non-interactive run that can use only the app's own tools.

## Requirements

### Requirement: The agent can run on the Claude Code CLI
A provider configuration of type `claude-code` SHALL answer chat requests by running the installed Claude Code CLI in non-interactive mode with the app's system prompt, the conversation and the chosen model. The answer MUST contain the final text, the tool trace (name, input, short result summary) and the lessons the agent changed, in the same shape as for other provider types.

#### Scenario: Answer from notes through the CLI
- **GIVEN** an active `claude-code` configuration assigned to the Learning assistant, and a note "Redis eviction policies"
- **WHEN** the user asks "what did I learn about redis eviction?"
- **THEN** the CLI is run once, it calls the note search and read tools, and the chat shows the answer with both tool calls in the trace

#### Scenario: Lesson written through the CLI
- **WHEN** the Lesson writer drafts the empty lesson `backend/caching` through a `claude-code` configuration
- **THEN** the lesson is saved with source `agent` and the answer lists `backend/caching` as changed

### Requirement: Only the app's tools are available, in an isolated run
The CLI run SHALL offer only the app's agent tools through an MCP server started for that run, with every built-in tool disabled. It MUST NOT load user or project settings, hooks, plugins, project instructions or other MCP servers, MUST run in an empty working folder, and MUST NOT save the session. The tools keep their rules: imported note text is wrapped as untrusted content, and a user-written lesson is never overwritten.

#### Scenario: No built-in tools
- **WHEN** the app runs the CLI
- **THEN** the command disables all built-in tools, allows only the app's MCP tools, uses a strict MCP configuration, and loads no setting sources

#### Scenario: User-written lesson stays
- **GIVEN** a lesson written by the user
- **WHEN** the agent tries to write that lesson through the CLI
- **THEN** the tool refuses and the lesson is unchanged

### Requirement: Sign-in uses the machine's login or a stored setup token
A `claude-code` configuration SHALL need no key. If a setup token is saved, it MUST be stored encrypted and passed to the CLI only through its environment, never on the command line, in a log or in an answer. Without a token, the CLI uses the machine's existing Claude Code login.

#### Scenario: Token through the environment
- **GIVEN** a `claude-code` configuration with a saved setup token
- **WHEN** the CLI is run
- **THEN** the token is in the process environment as `CLAUDE_CODE_OAUTH_TOKEN` and not in its arguments

### Requirement: Limits and errors are categorized
The run SHALL be stopped when the configured timeout or the agent step limit is reached. Errors MUST be categorized as for other providers: CLI not found is `invalid_config`, not signed in or an invalid token is `auth_failed`, a usage or rate limit is `rate_limited`, the timeout is `timeout`, and any other failure is `unavailable`. Test Connection uses the same categories.

#### Scenario: CLI not installed
- **WHEN** the user tests a `claude-code` configuration on a machine without the CLI
- **THEN** the result is `invalid_config` with a message saying that Claude Code is not installed

#### Scenario: Usage limit reached
- **WHEN** the CLI reports that the usage limit is reached
- **THEN** the result is `rate_limited`, and a fallback provider, if assigned, answers instead

#### Scenario: Timeout
- **WHEN** the CLI does not finish within the configured timeout
- **THEN** the process is stopped and the result is `timeout`
