# Spec Delta

## MODIFIED Requirements

### Requirement: Sign in with GitHub or Google
The system SHALL offer GitHub and Google sign-in through the authorization code flow with state and PKCE, using only a verified email from the provider. A provider without configured client ID and secret MUST NOT be offered on the sign-in pages; the offered ones show the provider's logo.

#### Scenario: Sign in with GitHub
- **GIVEN** the Owner's GitHub identity is linked
- **WHEN** they choose Continue with GitHub and approve
- **THEN** they are signed in and land on the page they were on

#### Scenario: Forged callback
- **WHEN** a callback arrives with a state that does not match the one set for this browser
- **THEN** it is refused and no session is created

#### Scenario: Not configured
- **GIVEN** no Google client ID is configured
- **WHEN** the login page shows
- **THEN** Continue with Google is not shown, and Continue with GitHub is shown only if GitHub is configured

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
- **THEN** the login page no longer offers Continue with Google

#### Scenario: Secret never returned
- **WHEN** the sign-in settings are read through the API
- **THEN** the answer has the Client ID and a hint of the secret, never the secret itself

#### Scenario: Only the Owner
- **WHEN** a request without a session reads or changes the sign-in settings
- **THEN** it is answered 401 and nothing changes

## ADDED Requirements

### Requirement: Sign-in page layout
The login page SHALL have a Sign up button at the top right of the page and the Sign up page a Log in button there. On the first visit, when no GitHub or Google sign-in is configured, the page SHALL say they can be added later in Settings -> Sign-in.

#### Scenario: Switch between log in and sign up
- **WHEN** a signed-out visitor presses Sign up at the top of the login page
- **THEN** the Sign up page shows, with Log in at the top that leads back

#### Scenario: First visit without providers
- **GIVEN** no GitHub or Google client is configured and no account exists
- **WHEN** the first visitor opens the app
- **THEN** the Create the admin account page offers no provider button and says GitHub and Google can be added later in Settings -> Sign-in
