## ADDED Requirements

### Requirement: Pasted keys are normalized
Before a key is validated or stored, the system SHALL remove every whitespace character (spaces, tabs and line breaks, as left by a terminal that wraps a long token) and every invisible format character (such as zero-width spaces) from it, then any surrounding quotes. When the paste holds exactly one Anthropic key or token among other text (a label or `export NAME=`), only that key or token is kept. The key length limit applies to the result.

#### Scenario: Token wrapped over lines
- **GIVEN** a key pasted as three lines with a line break between each part
- **WHEN** the user saves the configuration
- **THEN** it is saved as one key made of the three parts, and the hint shows its last four characters

#### Scenario: Token pasted with extra text
- **GIVEN** a paste of `export CLAUDE_CODE_OAUTH_TOKEN="<token>"`, or the token after a zero-width space
- **WHEN** the user tests or saves the configuration
- **THEN** only the token is used

#### Scenario: Rejected key says how it was sent
- **WHEN** Anthropic rejects the key during Test Connection
- **THEN** the message says whether it was sent as a setup token (OAuth) or as an API key, and never contains the key

### Requirement: Anthropic accepts an API key or a Claude setup token
An Anthropic configuration SHALL accept either an API key or a Claude setup token (from `claude setup-token`, starting with `sk-ant-oat`). A setup token MUST be sent as an OAuth bearer token together with the OAuth beta header, and an API key MUST be sent as an API key without that header; a key is never sent both ways. Provider information MUST say which kind of key is saved, never the key itself.

#### Scenario: Setup token is sent as a bearer token
- **GIVEN** an Anthropic configuration saved with a key that starts with `sk-ant-oat`
- **WHEN** the agent or Test Connection calls the provider
- **THEN** the client sends the token as an OAuth bearer token with `anthropic-beta: oauth-2025-04-20`, and not as an API key

#### Scenario: API key is sent as an API key
- **GIVEN** an Anthropic configuration saved with a key that starts with `sk-ant-api`
- **WHEN** the agent calls the provider
- **THEN** the client sends it as an API key, without the OAuth beta header

#### Scenario: Kind of key is shown
- **WHEN** the user reads an Anthropic configuration saved with a setup token
- **THEN** it shows "Setup token" with the last four characters, and no answer contains the token
