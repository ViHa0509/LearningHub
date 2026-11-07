## MODIFIED Requirements

### Requirement: Home page lists every role as a card
The app SHALL open on a home page that shows one card per loaded domain, in catalog order. Each card MUST show the domain title, its short description, and its progress as the number of nodes that have at least one note that is not archived, out of all nodes.

#### Scenario: Cards for all domains
- **GIVEN** the catalog has the domains Frontend, Backend, DevOps, QA, Data Engineer and AI Engineer
- **WHEN** the user opens the app at its root address
- **THEN** the home page shows six cards with those titles and their descriptions

#### Scenario: Progress on a card
- **GIVEN** notes are linked to `devops/aws` and `devops/cloud`, and DevOps has 21 nodes
- **WHEN** the home page is shown
- **THEN** the DevOps card shows 2 of 21 topics with notes

#### Scenario: Domain without a description
- **GIVEN** a domain's YAML file has no description
- **WHEN** the home page is shown
- **THEN** its card still shows the title and progress, with no description text

#### Scenario: Archived notes do not count as progress
- **GIVEN** the only note on `devops/aws` is archived
- **WHEN** the home page is shown
- **THEN** `devops/aws` does not count toward the DevOps progress
