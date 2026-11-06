# roadmap-catalog Specification

## Purpose
Provides the learning roadmaps (domains and their nodes) that every note is placed on, defined by hand in YAML files kept in the repository.

## Requirements

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

### Requirement: Node ids are stable and addressable
Each node SHALL be addressed by a full id made of the domain id and the node id joined by a slash (for example `backend/caching`). Node ids MUST be lowercase kebab-case and unique within their domain.

#### Scenario: Full node id
- **WHEN** a client reads the `caching` node of the `backend` domain
- **THEN** the node's full id is `backend/caching`

### Requirement: Invalid roadmap files stop startup with a clear error
The system SHALL refuse to start when a roadmap file is invalid, and the error MUST name the file and the offending node. Invalid means: unparsable YAML, a missing id or title, a duplicate node id in one domain, an id that is not kebab-case, a parent that does not exist, or a parent cycle.

#### Scenario: Duplicate node id
- **GIVEN** `backend.yaml` defines two nodes with id `caching`
- **WHEN** the backend starts
- **THEN** startup fails with an error naming `backend.yaml` and `caching`

#### Scenario: Unknown parent
- **GIVEN** a node in `devops.yaml` has parent `containers` and no node `containers` exists
- **WHEN** the backend starts
- **THEN** startup fails with an error naming `devops.yaml`, the node and the missing parent

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

### Requirement: Editing roadmaps never deletes notes
When roadmap files change and the system restarts, the system SHALL keep every note, including notes linked to a node that no longer exists.

#### Scenario: Node removed from YAML
- **GIVEN** a note is linked to `backend/soap` and the node `soap` is removed from `backend.yaml`
- **WHEN** the backend restarts
- **THEN** the note still exists and is reported as linked to a missing node (see node-linking)
