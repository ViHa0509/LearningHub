## ADDED Requirements

### Requirement: Enter a provider key in the app
The app SHALL have a Settings page with one card per provider where the user can enter an API key (for Ollama, a server URL), choose the model from the provider's list or type a custom model id, and save. A saved provider MUST be usable in the chat at once, without restarting the backend.

#### Scenario: Paste a key and chat
- **GIVEN** no provider is configured
- **WHEN** the user opens Settings, pastes an Anthropic key and saves
- **THEN** the Anthropic card shows "Saved in app", and the agent panel offers the chat with Anthropic without a backend restart

#### Scenario: Custom model id
- **WHEN** the user types `claude-sonnet-5-5-preview` as a custom model for Anthropic and saves
- **THEN** that model is the chat default for Anthropic and appears in the panel's model list

#### Scenario: Ollama URL
- **WHEN** the user enters `http://localhost:11434` for Ollama and saves
- **THEN** Ollama becomes available, and a value that is not an http or https URL is rejected with a message

### Requirement: Keys are kept secret
A key saved in the app SHALL be stored encrypted with a key that exists only on this computer (`LH_SECRET_KEY`, or a key file created on first use in the storage folder). The system MUST never return a key to a client; it returns only a hint with the last four characters. Saving without a key keeps the stored key.

#### Scenario: Key never returned
- **GIVEN** the user saved the key `sk-ant-api03-abcd1234`
- **WHEN** a client lists providers or reads any settings
- **THEN** the answer contains the hint `…1234` and never the key, and the database holds only the encrypted value

#### Scenario: Change only the model
- **WHEN** the user changes the model of a saved provider and saves with an empty key field
- **THEN** the stored key is kept

### Requirement: Test a provider with a real call
The Settings page SHALL offer a Test action per configured provider that sends one short request with the saved key, URL and model, and shows either success with the time it took or the provider's error message.

#### Scenario: Working key
- **WHEN** the user tests a provider whose key and model work
- **THEN** the card shows that the test passed, with the model name and the time in milliseconds

#### Scenario: Wrong key or model
- **WHEN** the user tests a provider and the provider rejects the key or the model id
- **THEN** the card shows the provider's error message and the provider stays saved

### Requirement: Switch off or remove a provider
The user SHALL be able to switch a provider off without deleting its key, and to remove a key saved in the app. A switched-off provider MUST NOT be offered in the chat. Removing an app key falls back to the `backend/.env` key when one exists.

#### Scenario: Switch off
- **WHEN** the user switches Anthropic off
- **THEN** the chat no longer offers Anthropic, a chat request to it is refused, and the key is still saved

#### Scenario: Remove
- **GIVEN** Anthropic has a key saved in the app and none in `backend/.env`
- **WHEN** the user removes it
- **THEN** Anthropic is not configured any more

### Requirement: App settings win over backend/.env
When a provider has both a key saved in the app and one in `backend/.env`, the system SHALL use the app key, and the Settings page MUST show which source is in use.

#### Scenario: Both sources
- **GIVEN** `LH_OPENAI_API_KEY` is set and the user saves another OpenAI key in the app
- **WHEN** the agent uses OpenAI
- **THEN** it uses the key saved in the app, and the card says "Saved in app (overrides backend/.env)"

#### Scenario: Only backend/.env
- **GIVEN** only `LH_OPENAI_API_KEY` is set
- **WHEN** the user opens Settings
- **THEN** the OpenAI card says "From backend/.env" and shows no key
