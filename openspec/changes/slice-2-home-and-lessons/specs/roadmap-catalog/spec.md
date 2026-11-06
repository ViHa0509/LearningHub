## MODIFIED Requirements

### Requirement: Roadmaps are defined in YAML files
The system SHALL load each domain roadmap from one YAML file in the repository's roadmap folder. A domain has an id, a title, an optional short description and a list of nodes; each node has an id, a title, an optional parent node id, an optional short description and an order among its siblings.

#### Scenario: Roadmap files are loaded at startup
- **GIVEN** the roadmap folder contains `backend.yaml` and `devops.yaml`
- **WHEN** the backend starts
- **THEN** the domains `backend` and `devops` are available with all their nodes

#### Scenario: Initial roadmap content
- **WHEN** the system is installed from this change
- **THEN** it ships with Frontend, Backend, DevOps, QA and Data Engineer roadmaps, each with a short description and between 15 and 25 nodes written by hand, and no content copied from roadmap.sh

#### Scenario: Domain description is optional
- **GIVEN** a roadmap file has no `description`
- **WHEN** the backend starts
- **THEN** the domain loads with an empty description

### Requirement: Clients can list domains and read a roadmap
The system SHALL let clients list all domains (id, title, description, node count, and the number of nodes that have at least one note) and read one domain's full roadmap as a tree of nodes in sibling order.

#### Scenario: List domains
- **WHEN** a client lists domains
- **THEN** it receives every loaded domain with its id, title, description, node count and number of nodes with notes

#### Scenario: Read a roadmap
- **WHEN** a client reads the roadmap of domain `backend`
- **THEN** it receives all nodes of that domain with id, full id, title, description, parent and order

#### Scenario: Unknown domain
- **WHEN** a client reads the roadmap of a domain that does not exist
- **THEN** the system answers with a not-found error
