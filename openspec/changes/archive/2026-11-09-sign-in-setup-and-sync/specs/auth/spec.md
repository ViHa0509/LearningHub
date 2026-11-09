## ADDED Requirements

### Requirement: Set up GitHub and Google sign-in in the app
The Settings page Sign-in SHALL let the Owner enter, change and remove the Client ID and Client secret for GitHub and for Google, with Save and Cancel, and show the callback URL to register (`<LH_PUBLIC_URL>/api/auth/oauth/<provider>/callback`) with a Copy button. Saved values MUST take effect without a restart and win over the environment variables. The secret MUST be stored encrypted and never returned; only its hint is shown.

#### Scenario: Turn on GitHub sign-in
- **GIVEN** GitHub is not configured
- **WHEN** the Owner saves a Client ID and Client secret for GitHub
- **THEN** the login page offers "Continue with GitHub" without a restart, and the settings show the secret only as a hint

#### Scenario: Callback URL shown
- **GIVEN** `LH_PUBLIC_URL` is `https://hub.example.com`
- **WHEN** the Owner opens Sign-in settings
- **THEN** the GitHub callback URL shown is `https://hub.example.com/api/auth/oauth/github/callback`

#### Scenario: Remove a provider
- **GIVEN** Google was set up in the app and no environment variable sets it
- **WHEN** the Owner removes Google
- **THEN** the login page shows Google as not configured

#### Scenario: Secret never returned
- **WHEN** the sign-in settings are read through the API
- **THEN** the answer has the Client ID and a hint of the secret, never the secret itself

#### Scenario: Only the Owner
- **WHEN** a request without a session reads or changes the sign-in settings
- **THEN** it is answered 401 and nothing changes
