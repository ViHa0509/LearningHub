## MODIFIED Requirements

### Requirement: Roadmaps are defined in YAML files
The system SHALL load each domain roadmap from one YAML file in the repository's roadmap folder. A domain has an id, a title, an optional short description and a list of nodes; each node has an id, a title, an optional parent node id, an optional short description and an order among its siblings.

#### Scenario: Roadmap files are loaded at startup
- **GIVEN** the roadmap folder contains `backend.yaml` and `devops.yaml`
- **WHEN** the backend starts
- **THEN** the domains `backend` and `devops` are available with all their nodes

#### Scenario: Initial roadmap content
- **WHEN** the system is installed from this change
- **THEN** it ships with Frontend, Backend, DevOps, QA, Data Engineer and AI Engineer roadmaps, in that order, each with a short description and between 15 and 25 nodes written by hand, and no content copied from roadmap.sh

#### Scenario: Domain description is optional
- **GIVEN** a roadmap file has no `description`
- **WHEN** the backend starts
- **THEN** the domain loads with an empty description
