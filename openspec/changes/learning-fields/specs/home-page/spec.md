# Spec Delta

## ADDED Requirements

### Requirement: Home page tabs per field
The home page SHALL show one tab per visible field, "IT" first, then the user's fields and published fields in order, and a "New field" action. Each tab shows the cards of its areas with the same progress as the role cards. The chosen tab is remembered by the browser.

#### Scenario: Tabs
- **GIVEN** the user has the field "Cloud" with areas AWS and Azure
- **WHEN** the user opens the home page and chooses the "Cloud" tab
- **THEN** the AWS and Azure cards are shown, and after a reload the "Cloud" tab is still chosen

#### Scenario: IT tab
- **WHEN** a user without fields opens the home page
- **THEN** only the IT tab is shown, with the six role cards, and the New field action
