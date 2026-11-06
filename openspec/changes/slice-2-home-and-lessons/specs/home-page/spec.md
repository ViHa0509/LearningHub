## ADDED Requirements

### Requirement: Home page lists every role as a card
The app SHALL open on a home page that shows one card per loaded domain, in catalog order. Each card MUST show the domain title, its short description, and its progress as the number of nodes that have at least one note out of all nodes.

#### Scenario: Cards for all domains
- **GIVEN** the catalog has the domains Frontend, Backend, DevOps, QA and Data Engineer
- **WHEN** the user opens the app at its root address
- **THEN** the home page shows five cards with those titles and their descriptions

#### Scenario: Progress on a card
- **GIVEN** notes are linked to `devops/aws` and `devops/cloud`, and DevOps has 21 nodes
- **WHEN** the home page is shown
- **THEN** the DevOps card shows 2 of 21 topics with notes

#### Scenario: Domain without a description
- **GIVEN** a domain's YAML file has no description
- **WHEN** the home page is shown
- **THEN** its card still shows the title and progress, with no description text

### Requirement: A card opens its roadmap
Choosing a card SHALL open that domain's roadmap map. The app MUST offer a way back to the home page from every page.

#### Scenario: Open a roadmap from home
- **WHEN** the user clicks the Backend card
- **THEN** the Backend roadmap map is shown and the address is `#/roadmap/backend`

#### Scenario: Back to home
- **WHEN** the user clicks the app title in the top bar
- **THEN** the home page is shown
