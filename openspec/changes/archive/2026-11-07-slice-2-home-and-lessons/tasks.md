# Tasks

## 1. Roadmap catalog (spec: roadmap-catalog)

- [x] 1.1 Add optional domain `description` and `order` to the YAML loader and catalog ordering, and verify pytest cases for a domain with and without description and for explicit order
- [x] 1.2 Write `roadmaps/frontend.yaml`, `roadmaps/qa.yaml`, `roadmaps/data-engineer.yaml` by hand (15-25 nodes each) and add descriptions and order to `backend.yaml` and `devops.yaml`, and verify `test_shipped_roadmaps_have_15_to_25_nodes` covers all five and each has a description
- [x] 1.3 Return `description` and `learned_nodes` from `GET /api/domains`, and verify an API test with notes on two nodes of one domain

## 2. Lessons (spec: lesson-pages)

- [x] 2.1 Add the `lessons` table with Alembic migration 0002 (up and down), and verify the migration test runs downgrade base and upgrade head with both tables
- [x] 2.2 Implement `GET/PUT /api/lessons/{domain}/{node}` (upsert, empty body deletes, source validated, 404 for unknown domain or node), and verify API tests for every lesson-pages storage scenario including restart persistence

## 3. Navigation and theme (spec: learning-views, home-page)

- [x] 3.1 Add the hash router hook and top bar (title links home, theme switch with system/light/dark stored in localStorage), and restructure the center pane by route, and verify Vitest tests for back navigation, open-by-address and theme persistence
- [x] 3.2 Add the home page with domain cards (title, description, progress) opening `#/roadmap/<domain>`, and verify Vitest tests for every home-page scenario
- [x] 3.3 Make list clicks open the note directly (remove the Open button, keep node selection), and verify the updated two-way selection and read-a-note tests

## 4. Lesson page (spec: lesson-pages, learning-views)

- [x] 4.1 Add the lesson page (breadcrumb, description, subtopic links, linked notes, roadmap.sh link, unknown-node message) and open it from map node clicks, and verify Vitest tests for open-from-map, empty node, unknown node and the roadmap.sh link
- [x] 4.2 Add lesson editing (edit, save, clear) rendered with react-markdown without raw HTML, and verify Vitest tests for write, clear and the script-in-lesson scenario

## 5. UI checks and verification

- [x] 5.1 Add the Playwright suite (`frontend/e2e/`, Edge channel, backend on 8001 with `learninghub_e2e`, Vite on 5174, reset in global setup, screenshots per page) covering home -> roadmap -> lesson edit -> import -> open note -> theme, add the database to `docker/db-init`, add `npm run e2e` as a check in CLAUDE.md, and verify the suite passes
- [x] 5.2 Run every CLAUDE.md check, the UI QC agent and the verifier subagent on this change, record results in `evidence.md`, and verify the verifier verdict is pass
