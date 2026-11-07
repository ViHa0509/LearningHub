## REMOVED Requirements

### Requirement: Enter a provider key in the app
**Reason**: Replaced by named provider configurations (`ai-providers`: Manage provider configurations).
**Migration**: Saved keys are moved into configurations by migration 0004.

### Requirement: Keys are kept secret
**Reason**: Replaced by `ai-providers`: API keys are encrypted and never exposed.
**Migration**: Same encryption secret; tokens are copied unchanged.

### Requirement: Test a provider with a real call
**Reason**: Replaced by `ai-providers`: Test a connection with a categorized result.
**Migration**: None.

### Requirement: Switch off or remove a provider
**Reason**: Replaced by the active switch and safe delete in `ai-providers`.
**Migration**: The enabled flag becomes `is_active`.

### Requirement: App settings win over backend/.env
**Reason**: `.env` keys are now imported once as configurations (`ai-providers`: Existing settings are carried over), so there is a single source.
**Migration**: Startup import of `LH_*` values.
