## ADDED Requirements

### Requirement: Manage provider configurations
The system SHALL let the user list, create, read, update and delete named provider configurations. A configuration has a unique name, a type (`openai`, `anthropic`, `gemini`, `local`, `custom`), a model id, an optional API key, an optional base URL, parameters (temperature, max tokens, top p, timeout, and advanced parameters), an active switch, and its last test result. Several configurations of the same type MAY exist.

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

### Requirement: Required fields and parameter ranges are validated
The system SHALL reject a configuration that lacks a name or model, lacks a key for `openai`, `anthropic` or `gemini`, or lacks a base URL for `local` or `custom`. It SHALL also reject parameters outside these ranges: temperature 0-2, top p 0-1, max tokens 1-200000, timeout 1-600 seconds. The error MUST name the field.

#### Scenario: Missing key
- **WHEN** the user saves a new `openai` configuration without a key
- **THEN** the system refuses it and names the API key field

#### Scenario: Out of range
- **WHEN** the user saves a temperature of 3
- **THEN** the system refuses it and names the temperature field

### Requirement: Only parameters the type supports are offered and sent
The system SHALL describe, for each provider type, which parameters it supports. Anthropic supports temperature, max tokens, top p, top k and stop sequences. OpenAI, Gemini, Local and Custom support temperature, max tokens, top p, frequency penalty, presence penalty, stop sequences, seed and JSON response format. The system MUST send to the provider only the parameters that are supported and set. Provider-specific extra parameters MAY be given as a JSON object, which is passed through.

#### Scenario: Unset parameters are not sent
- **GIVEN** a configuration with only temperature 0.2 set
- **WHEN** the agent calls the model
- **THEN** the request carries temperature 0.2 and no top p, penalties or seed

#### Scenario: Unsupported parameter
- **WHEN** the user saves an `anthropic` configuration with a frequency penalty
- **THEN** the system refuses it and says the parameter is not supported by Anthropic

### Requirement: API keys are encrypted and never exposed
API keys SHALL be stored encrypted with the app's secret (`LH_SECRET_KEY` or the key file in the storage folder). No API answer and no log line may contain a key; answers carry only a hint with the last four characters.

#### Scenario: Key never returned or logged
- **GIVEN** a configuration saved with the key `sk-test-abcd1234`
- **WHEN** a client lists, reads, updates or tests it, and the agent uses it
- **THEN** no answer and no log record contains the key, the answers show `…1234`, and the database holds only the encrypted value

### Requirement: Base URLs are checked against SSRF
The system SHALL accept only `http` or `https` base URLs without embedded credentials. For every type except `local`, it SHALL require `https` and reject hosts that resolve to loopback, private, link-local, reserved or unspecified addresses, including cloud metadata addresses. `local` MAY point at localhost or private addresses.

#### Scenario: Metadata address
- **WHEN** the user sets the base URL of a `custom` configuration to `http://169.254.169.254/v1`
- **THEN** the system refuses it and says private and link-local addresses are only allowed for Local

#### Scenario: Local server
- **WHEN** the user sets the base URL of a `local` configuration to `http://localhost:11434/v1`
- **THEN** it is accepted

### Requirement: Test a connection with a categorized result
The system SHALL test a saved configuration, or settings that are not saved yet, by validating it, sending one short request and measuring the time. The result MUST be one of `ok`, `auth_failed`, `invalid_model`, `unavailable`, `timeout`, `rate_limited` or `invalid_config`, together with a readable message and the latency. For a saved configuration, the result and, on success, the time of the last successful test are stored.

#### Scenario: Success
- **WHEN** the user tests a configuration whose key and model work
- **THEN** the result is `ok` with the latency, and "last successful test" shows the time

#### Scenario: Wrong key
- **WHEN** the provider answers 401 or 403
- **THEN** the result is `auth_failed` with the provider's message

#### Scenario: Unknown model
- **WHEN** the provider says the model does not exist
- **THEN** the result is `invalid_model`

#### Scenario: Rate limit, timeout, unavailable
- **WHEN** the provider answers 429, does not answer within the timeout, or cannot be reached or answers 5xx
- **THEN** the result is `rate_limited`, `timeout` or `unavailable` respectively

#### Scenario: Test before saving
- **WHEN** the user fills the form and presses Test Connection before saving
- **THEN** the unsaved settings are tested (reusing the stored key when editing and the key field is empty), and nothing is saved

### Requirement: List the provider's models
The system SHALL list the models a saved configuration's provider offers, by asking the provider. Model presets per type SHALL come from a configuration file, and any model id MAY be typed.

#### Scenario: Load models
- **WHEN** the user presses "Load models" on a working configuration
- **THEN** the model field offers the ids the provider returned

### Requirement: Provider information
The configuration page SHALL show the provider name, type, model, context window and maximum output tokens (when known from the catalog or set by the user), the capabilities of the type, the connection status and the time of the last successful test.

#### Scenario: Never tested
- **WHEN** the user opens a configuration that was never tested
- **THEN** the information panel says "Not tested yet"

### Requirement: Changes to provider settings come from this app only
Mutating provider and agent endpoints SHALL require the request header `X-LearningHub: 1`. Requests without it MUST be refused with a forbidden error, so that other origins, including imported note pages, cannot change settings.

#### Scenario: Missing header
- **WHEN** a request creates a provider without the `X-LearningHub` header
- **THEN** the system answers forbidden and stores nothing

### Requirement: Delete is safe
Deleting a configuration that an agent uses as primary or fallback SHALL be refused, and the refusal MUST name those agents. An unused configuration is deleted with its key.

#### Scenario: Provider in use
- **GIVEN** "Claude main" is the assistant's primary provider
- **WHEN** the user deletes it
- **THEN** the system refuses and names the Learning assistant

### Requirement: Existing settings are carried over
The migration SHALL move every provider saved in the earlier per-vendor settings into a named configuration, with its encrypted key, model and active state, and assign the first of them to both agents. At startup, each `LH_*_API_KEY` or `LH_OLLAMA_URL` value in `backend/.env` SHALL be imported once as a configuration named "<Type> (from .env)" when no configuration with that name exists.

#### Scenario: .env key imported
- **GIVEN** `LH_ANTHROPIC_API_KEY` is set and no configuration is named "Anthropic (from .env)"
- **WHEN** the backend starts
- **THEN** that configuration exists, active, with the key encrypted
