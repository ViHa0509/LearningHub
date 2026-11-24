## ADDED Requirements

### Requirement: Unsorted is grouped by category
Inside the Unsorted group, the Learned list SHALL show one sub-group per category of the unsorted notes, headed by the category name as plain text and ordered by their newest note, then an "Other" sub-group for notes without a category. With no category at all, Unsorted MUST look as before. The filter applies inside the sub-groups; Unsorted stays one drop target.

#### Scenario: Categories in Unsorted
- **GIVEN** unsorted notes "Pod limits" and "Helm charts" with category "Kubernetes", "Salary talk" with category "Career", and "Loose idea" without a category
- **WHEN** the user looks at the Learned list
- **THEN** Unsorted shows the sub-groups Kubernetes, Career and Other with those notes, Other last

#### Scenario: A linked note leaves its category group
- **WHEN** the user moves "Pod limits" to the node `devops/kubernetes`
- **THEN** it is listed under DevOps > Kubernetes and no longer under the Kubernetes sub-group of Unsorted

### Requirement: Group unsorted notes with AI
The Unsorted heading SHALL have a "Group with AI" button that sends the titles and the start of the text of the user's unsorted notes (the 200 newest) to the Note sorter agent in one model call and gives each note the category the agent picked; a note left out gets no category. While it runs the button MUST be disabled and show it is working. It counts like one chat request toward the limits.

#### Scenario: Group with AI
- **GIVEN** five unsorted notes without a category
- **WHEN** the user clicks Group with AI and the agent answers with the groups "Kubernetes" (two notes) and "Career" (two notes)
- **THEN** Unsorted shows Kubernetes and Career with those notes and Other with the fifth

#### Scenario: Unreadable answer
- **WHEN** the agent's answer is not the expected JSON
- **THEN** an error is shown and no note's category changes

#### Scenario: No provider
- **GIVEN** the user has no provider for the Note sorter and no shared provider
- **WHEN** they click Group with AI
- **THEN** the error says to set up a provider, and nothing changes

#### Scenario: Limits
- **WHEN** a member on the shared provider clicks Group with AI
- **THEN** it uses one request of their shared daily limit; the admin's clicks use none

#### Scenario: Another user's notes
- **WHEN** user B runs Group with AI
- **THEN** user A's notes are neither sent to the model nor changed

### Requirement: Rename a category group
Each category heading in Unsorted SHALL offer Rename with Save and Cancel; Save MUST stay disabled while the name is empty, longer than 40 characters or unchanged. Saving renames the category on all of the user's notes; renaming to an existing name merges the two groups.

#### Scenario: Rename a group
- **WHEN** the user renames "Kubernetes" to "K8s" and clicks Save
- **THEN** the sub-group is called K8s with the same notes, and Cancel instead leaves it as Kubernetes
