# Spec Delta

## ADDED Requirements

### Requirement: Fields and areas
A user SHALL be able to create, rename, reorder and delete fields, and in their fields create, rename, reorder and delete areas with a fixed slug, a title and an optional description. Every account sees the virtual field "IT" with the built-in roles. A field or area of another user is not visible unless its field is published.

#### Scenario: New field and area
- **WHEN** the user creates the field "Cloud" and in it the area "AWS" with slug `aws`
- **THEN** the home page has a "Cloud" tab with an "AWS" card, and `#/roadmap/aws` opens its map

#### Scenario: Slug taken
- **WHEN** the user creates an area with slug `backend` or a slug another area already uses
- **THEN** it is refused with a message that the slug is taken

#### Scenario: Another user's field
- **GIVEN** user A has a private field "Cloud"
- **WHEN** user B lists fields or reads A's area `aws`
- **THEN** B does not see the field and reading the area answers not found

### Requirement: Topics of an area
The owner SHALL be able to edit the topics of an area (title, slug, parent, description, order) in one editor saved with Save or discarded with Cancel. Saving replaces the list; slugs must be unique kebab-case, parents must exist in the area and form no cycle, at most 300 topics. Removing a topic never deletes notes or lessons linked to it.

#### Scenario: Save topics
- **WHEN** the owner adds "IAM" and "EC2" to the area `aws` and saves
- **THEN** the map shows both topics and each has a lesson page

#### Scenario: Invalid topics
- **WHEN** the owner saves two topics with the same slug, or a parent that does not exist
- **THEN** nothing is saved and the editor shows what is wrong

#### Scenario: Removed topic keeps notes
- **GIVEN** a note is linked to `aws/iam`
- **WHEN** the owner removes the topic `iam`
- **THEN** the note still exists and shows that its linked topic no longer exists

### Requirement: Draft topics with the agent
On an area without topics, the app SHALL offer "Draft topics with agent". The outline agent proposes topics through a tool that does not save; the user opens the proposal in the topic editor and saves it there.

#### Scenario: Draft and review
- **GIVEN** an empty area `aws` and an available provider
- **WHEN** the user chooses "Draft topics with agent"
- **THEN** the agent's answer offers "Review in editor", which opens the editor filled with the proposed topics, and nothing is saved until the user presses Save

### Requirement: Published fields
The admin SHALL be able to publish or unpublish one of their fields. A published field is shown to every account, read only; each user's notes and lessons on its topics stay their own.

#### Scenario: Publish
- **GIVEN** the admin's field "Driving licence"
- **WHEN** the admin publishes it
- **THEN** a member sees the "Driving licence" tab and its areas, cannot edit them, and can link notes and write lessons on its topics

#### Scenario: Members cannot publish
- **WHEN** a member tries to publish their own field
- **THEN** it is refused as admin only
