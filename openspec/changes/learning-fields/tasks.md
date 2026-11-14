# Tasks

## 1. Data and catalog

- [x] 1.1 Models and migration `0015_learning_fields.py` (design decision 1); `tests/conftest.py` truncates the new tables; verify with `test_migrations.py` (tables exist with RLS, downgrade removes them, deleting a user removes their fields)
- [x] 1.2 `app/learning/catalog.py` `catalog_for(session, user)` (built-in + own + published) and the `UserCatalog` dependency; replace `get_catalog(request)` in `routes/domains.py`, `notes.py`, `lessons.py`, `resources.py` and pass the user catalog to `run_agent`/`AgentTools`; `DomainSummary` gains `field_id`, `field_title`, `editable`; verify with the existing suite unchanged plus new cases for "The catalog a user sees"

## 2. API

- [x] 2.1 `routes/fields.py` (design decision 3) with validation and 404/403/409 rules; verify with `test_learning_fields.py` for every scenario of "Fields and areas", "Topics of an area", "Published fields", and isolation cases
- [x] 2.2 Outline agent and tool `propose_topics` (returns the proposal, saves nothing); chat answer carries the proposal; verify with agent tests (fake model)
- [x] 2.3 Backup and restore of fields (design decision 6); verify with `test_data_backup.py` cases

## 3. Frontend

- [x] 3.1 `api.ts` and `test/fakeApi.ts` for fields, areas, topics; home tabs with New field, field menu (Rename, Delete, Publish for the admin), New area; verify with Vitest for "Home page tabs per field"
- [x] 3.2 Topic editor on the area map page (Save/Cancel, errors from the API), empty-area actions, "Review in editor" from the agent answer; verify with Vitest for "Topics of an area" and "Draft topics with the agent"

## 4. E2E and integration

- [ ] 4.1 e2e `learning-fields.e2e.ts`: create field and area, edit topics, link a note, lesson page, publish to a member (read only), screenshots light/dark and phone; `npm run e2e` passes
- [ ] 4.2 Every check in `CLAUDE.md` passes, `openspec validate learning-fields --strict` passes; verifier report
