# Spec Delta

## MODIFIED Requirements

### Requirement: Further reading link
A lesson page of a built-in IT role SHALL link to roadmap.sh for the node's domain, opened in a new tab, so the user can look up the topic there. A lesson page of a learning-field area SHALL NOT show a Further reading link, because roadmap.sh does not cover it.

#### Scenario: Link to roadmap.sh
- **WHEN** the user opens the lesson page of `devops/docker`
- **THEN** the page has a link to `https://roadmap.sh/devops` that opens in a new tab

#### Scenario: No link on a field area
- **GIVEN** the user's area `o-to-hang-b` in the field Lái xe
- **WHEN** the user opens the lesson page of `o-to-hang-b/chuong-1`
- **THEN** the page has no Further reading line
