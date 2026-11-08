## ADDED Requirements

### Requirement: Back from Settings
The Settings page SHALL show a Back link that returns to the last page the user opened outside Settings and its provider pages. When there is none, it MUST go to the home page.

#### Scenario: Back to the lesson
- **GIVEN** the user is on the lesson page of `devops/helm`
- **WHEN** they open Settings, open a provider, return to Settings and click Back
- **THEN** the lesson page of `devops/helm` is shown

#### Scenario: Settings opened directly
- **GIVEN** the app was opened at `#/settings`
- **WHEN** the user clicks Back
- **THEN** the home page is shown
