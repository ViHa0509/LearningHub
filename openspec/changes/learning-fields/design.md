# Design

## Context

- Built-in roadmaps are YAML files loaded once into `RoadmapCatalog` (`app/roadmaps.py`): `Domain(id, title, nodes, description, order)` and `Node(domain, id, title, description, parent, order)`; notes, lessons and resources refer to nodes by `"<domain>/<node>"`.
- Every catalog user reads `request.app.state.catalog` (routes `domains`, `notes`, `lessons`, `resources`, agent `loop.py` and `tools.py`).
- Personal data is per user (`user_fk()`), another user's id answers 404; mutating routes need `X-LearningHub: 1`; migrations end with RLS on every table.

## Decisions

### 1. Data model (migration 0015)

- `learning_fields`: id uuid, user_id (owner), title (1-60), order int, published bool default false, created_at, updated_at.
- `learning_areas`: id uuid, field_id fk CASCADE, slug (kebab, 2-40, unique among all areas and not a built-in domain id), title (1-60), description (0-200), order int.
- `learning_topics`: id uuid, area_id fk CASCADE, slug (kebab, unique per area), title (1-80), description (0-300), parent_slug nullable (same area), order int.
- Ownership goes through the field (`learning_fields.user_id`), like chat messages through their session.
- Slugs are global across areas because node ids are `"<area slug>/<topic slug>"` and notes store that string. The slug is fixed at creation (renaming changes the title only), so notes never lose their topic.

### 2. Catalog per request

`catalog_for(session, user) -> RoadmapCatalog` = built-in domains + areas of the user's fields + areas of published fields, as `Domain`/`Node` values (order: built-ins, then fields by order, areas by order). A FastAPI dependency `UserCatalog` replaces `get_catalog(request)` in the routes; `AgentTools` and `run_agent` receive the same object. Built at most once per request; a few hundred rows at most, no cache.

`DomainSummary` gains `field_id` (null for built-ins), `field_title` ("IT" for built-ins) and `editable` (owner of the field). `GET /api/fields` lists the visible fields with their areas; the IT field is virtual (id `it`, not stored, not editable).

### 3. API

| Route | Who | Notes |
|---|---|---|
| `GET /api/fields` | any user | own + published fields, then IT; each with areas (summary like a domain card) |
| `POST /api/fields` `{title}` | any user | |
| `PATCH /api/fields/{id}` `{title?, order?, published?}` | owner; `published` admin only (403 otherwise) | |
| `DELETE /api/fields/{id}` | owner | deletes its areas and topics; notes/lessons stay (missing topic) |
| `POST /api/fields/{id}/areas` `{slug, title, description?}` | owner | 409 slug taken |
| `PATCH/DELETE /api/areas/{slug}` | owner | |
| `PUT /api/areas/{slug}/topics` `{topics: [{slug, title, description?, parent?}]}` | owner | replaces the whole list in one transaction (the editor saves all at once); order = list order; validation: kebab slugs, unique, parent exists, no cycle, at most 300 topics |

Someone else's private field or area answers 404; a published field is readable by all and editable by its owner only (403 on change).

### 4. Outline agent

New agent `outline` ("Topic outline") with tool `propose_topics(area, topics)` that does NOT save: it returns the proposal to the chat answer, and the panel shows a "Review in editor" button that opens the topic editor pre-filled; the user saves. Instructions ask for 8-25 topics, at most 2 levels, kebab slugs, short descriptions. No lessons are written.

### 5. Frontend

- Home: a tab list (role `tablist`) with IT first, then the user's and published fields, and "+ New field". The chosen tab is remembered in localStorage. Each tab shows its area cards (same card as today) and, for an editable field, "+ New area", Rename and Delete (confirm).
- Area map page: the existing map for areas with topics; "Edit topics" opens an editor (table of rows: title, slug, parent select, description, up/down, remove; Add topic; Save and Cancel; validation messages from the API).
- Empty area: "Add topics" and "Draft topics with agent".

### 6. Backup and restore

`data/learning_fields.json` (fields with nested areas and topics), optional on restore like chat history. Restore replaces the user's fields; a slug that is now taken by another user's area is refused with a clear message.

## Risks

- Global slugs: two users cannot both have area "aws". Accepted for a small app; the error says to pick another slug.
- Publishing: a published field shows the owner's topic map to everyone; it contains no notes or lessons.
