# Spec Delta

## ADDED Requirements

### Requirement: Prompt caching on Anthropic providers
Requests to an Anthropic provider SHALL ask for prompt caching of their prefix (tools, system prompt and conversation), unless the provider configuration turns it off with `prompt_cache: false`.

#### Scenario: Cached by default
- **WHEN** the agent calls an Anthropic provider
- **THEN** the request carries `cache_control` of type ephemeral

#### Scenario: Turned off
- **GIVEN** a provider configuration with `prompt_cache` false
- **WHEN** the agent calls it
- **THEN** the request carries no `cache_control`
