## MODIFIED Requirements

### Requirement: Manage provider configurations
The system SHALL let the user list, create, read, update and delete named provider configurations. A configuration has a unique name, a type (`openai`, `anthropic`, `gemini`, `local`, `custom`, `claude-code`), a model id, an optional API key, an optional base URL, parameters (temperature, max tokens, top p, timeout, and advanced parameters), an active switch, and its last test result. Several configurations of the same type MAY exist.

#### Scenario: Create and list
- **WHEN** the user creates "Claude main" of type `anthropic` with model `claude-sonnet-5-5` and a key
- **THEN** it appears in the provider list as active, with its type, model, key hint and "not tested yet"

#### Scenario: Duplicate name
- **WHEN** the user creates a configuration whose name already exists
- **THEN** the system refuses it with a message that the name is taken

#### Scenario: Edit keeps the key
- **WHEN** the user changes the temperature of a saved configuration and leaves the key field empty
- **THEN** the temperature is saved and the stored key is kept

#### Scenario: Deactivate
- **WHEN** the user switches a configuration off
- **THEN** no agent uses it until it is switched on again, and the configuration and its key are kept

#### Scenario: Claude Code configuration
- **WHEN** the user creates "Claude subscription" of type `claude-code` with model `sonnet` and no key
- **THEN** it is saved and listed with the type "Claude Code (subscription)"

### Requirement: Required fields and parameter ranges are validated
The system SHALL reject a configuration that lacks a name or model, lacks a key for `openai`, `anthropic` or `gemini`, or lacks a base URL for `local` or `custom`. A `claude-code` configuration needs no key and MUST NOT have a base URL. The system SHALL also reject parameters outside these ranges: temperature 0-2, top p 0-1, max tokens 1-200000, timeout 1-600 seconds. The error MUST name the field.

#### Scenario: Missing key
- **WHEN** the user saves a new `openai` configuration without a key
- **THEN** the system refuses it and names the API key field

#### Scenario: Out of range
- **WHEN** the user saves a temperature of 3
- **THEN** the system refuses it and names the temperature field

#### Scenario: Base URL on Claude Code
- **WHEN** the user saves a `claude-code` configuration with a base URL
- **THEN** the system refuses it and names the base URL field

### Requirement: Only parameters the type supports are offered and sent
The system SHALL describe, for each provider type, which parameters it supports. Anthropic supports temperature, max tokens, top p, top k and stop sequences. OpenAI, Gemini, Local and Custom support temperature, max tokens, top p, frequency penalty, presence penalty, stop sequences, seed and JSON response format. Claude Code supports only the timeout. The system MUST send to the provider only the parameters that are supported and set. Provider-specific extra parameters MAY be given as a JSON object, which is passed through, except for Claude Code, which takes none.

#### Scenario: Unset parameters are not sent
- **GIVEN** a configuration with only temperature 0.2 set
- **WHEN** the agent calls the model
- **THEN** the request carries temperature 0.2 and no top p, penalties or seed

#### Scenario: Unsupported parameter
- **WHEN** the user saves an `anthropic` configuration with a frequency penalty
- **THEN** the system refuses it and says the parameter is not supported by Anthropic

#### Scenario: No sampling for Claude Code
- **WHEN** the user saves a `claude-code` configuration with a temperature
- **THEN** the system refuses it and says the parameter is not supported by Claude Code
