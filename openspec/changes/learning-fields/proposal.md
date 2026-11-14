# Proposal

## Why

Learning Hub only knows the IT roles shipped as YAML roadmaps. The owner also learns outside IT and wants other fields on the home page: Business Analysis, Project Management, Cloud (AWS, Azure), the car driving licence, and more (2026-11-14). Decisions taken with the owner: the user creates the topic maps, the agent can draft one; areas are private, and the admin can publish one to every account.

## What Changes

- **Fields as home-page tabs.** The home page has a tab per field. "IT" holds the built-in roles as today. A user adds a field (e.g. "Cloud", "Driving licence"), renames or deletes it.
- **Areas in a field.** A field holds areas (shown as the same cards as the IT roles), e.g. "AWS" and "Azure" under Cloud. An area is a domain like the built-in ones: it has a topic map, notes link to its topics, every topic has a lesson page, the agent sees it.
- **Topics.** The user adds, renames, moves (parent, order) and deletes the topics of an area in an editor on the area's map page, with Save and Cancel. Deleting a topic never deletes notes or lessons: they show as linked to a missing topic, as today.
- **Draft with agent.** On an empty area, "Draft topics with agent" asks the lesson writer's sibling, a new **outline** agent, to propose 8 to 25 topics with parents through a new tool; the user reviews them in the editor before they are saved.
- **Private, publishable.** Fields and areas belong to the user. The admin can publish a field: every account then sees it (read only), with its own notes and lessons per user.
- Backup and restore include the user's fields, areas and topics.

Not in this change: question banks and practice exams (change `practice-exams`), sharing between non-admin users, editing the built-in IT roadmaps.

## Capabilities

### New Capabilities
- `learning-fields`: fields, areas and topics owned by a user; publishing by the admin.

### Modified Capabilities
- `home-page`: tabs per field; IT is one of them.
- `roadmap-catalog`: the catalog a user sees is the built-in roadmaps plus their own and published areas.
- `data-sync`: backup and restore cover fields, areas and topics.

## Impact

- Backend: tables `learning_fields`, `learning_areas`, `learning_topics` (migration 0015); a per-request catalog (built-in + the user's + published) used by every route and agent tool that uses the catalog today; routes `/api/fields`; tool `propose_topics` for the outline agent.
- Frontend: home tabs, field/area dialogs, topic editor on the map page, area cards.
- Tests: backend (routes, isolation, catalog merge, backup), Vitest, e2e.
