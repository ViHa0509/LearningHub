## MODIFIED Requirements

### Requirement: Providers are configured on the backend
The system SHALL support the providers Anthropic, OpenAI, DeepSeek and a local OpenAI-compatible server (Ollama). A provider is available when it is switched on and has a key (or, for the local server, a URL) saved in the app's settings or set in `backend/.env`. Clients MUST be able to list all providers with their models, the model chosen for each, whether they are available, where their configuration comes from and a key hint, and the list MUST never contain a key.

#### Scenario: No provider configured
- **GIVEN** no provider key or URL is set in the app or in `backend/.env`
- **WHEN** a client lists providers
- **THEN** every provider is listed as not available, with the name of the setting that enables it

#### Scenario: One provider configured
- **GIVEN** only `LH_ANTHROPIC_API_KEY` is set
- **WHEN** a client lists providers
- **THEN** Anthropic is available with its models and source `env`, the others are not, and no key appears in the answer

#### Scenario: Chat with an unavailable provider
- **WHEN** a client sends a chat to a provider that is not configured or is switched off
- **THEN** the system answers with a conflict error that says how to configure or switch it on, and calls no model

## ADDED Requirements

### Requirement: Chat requests are rate-limited
The system SHALL refuse chat requests beyond a per-minute limit (default 20, setting `LH_AGENT_RATE_PER_MINUTE`) with a too-many-requests error that says when to try again, without calling any model.

#### Scenario: Over the limit
- **GIVEN** the limit is 2 per minute and two chat requests were made in the last minute
- **WHEN** a third chat request arrives
- **THEN** the system answers with a too-many-requests error and the provider is not called
