# Tasks

## 1. Backend (spec: knowledge-import, node-linking, home-page, agent-chat)

- [x] 1.1 Add `archived_at` to `notes` with Alembic migration 0005 (up and down) and the model, and verify the migration test runs downgrade base and upgrade head
- [x] 1.2 Accept `archived` in `PATCH /api/notes/{id}`, return `archived_at` in note responses, exclude archived notes from `GET /api/notes`, `?node=` and `?unsorted=`, add `?archived=true`, and verify pytest cases for every archive/restore and query scenario
- [x] 1.3 Exclude archived notes from domain `learned_nodes` and per-node counts, and verify pytest cases for "Archived notes are not counted" and the home-page progress scenario
- [x] 1.4 Make `search_notes` skip archived notes while `read_note` still reads them, and verify pytest cases for both agent-chat scenarios

## 2. AI Engineer roadmap (spec: roadmap-catalog, home-page)

- [x] 2.1 Write `roadmaps/ai-engineer.yaml` by hand (order 6, description, 20 nodes) and update the shipped-roadmap tests to six domains in order, and verify the roadmap tests pass

## 3. Frontend (spec: learning-views, home-page)

- [x] 3.1 Add `archived_at` and the archive/restore calls to `api.ts`, the archived-notes query and invalidation in hooks, and archive support in the fake API
- [x] 3.2 Add the per-item "More actions" menu (Rename inline, Move to node, Archive with Undo) and the Archived section (count, Restore, Delete with confirmation, filter applies), and verify Vitest tests for every Learned-items list scenario
- [x] 3.3 Show the archived banner with Restore and the Archive/Restore action on the note page, and verify Vitest tests for the "Archived note page" scenario
- [x] 3.4 Update the home-page tests for six cards, and verify they pass

## 4. Visual identity (design 7)

- [x] 4.1 Create the logo mark (full and small), wordmark lockup, favicon (SVG + 32 px PNG), the 1.5 px monochrome icon set and the brand sheet in `docs/brand/`, and verify the favicon is readable at 16 px in a screenshot
- [x] 4.2 Apply the identity to the app (palette tokens for light and dark, `#0F0F12` dark background with the particle-network glow, logo in the top bar, favicon, icon set replacing text glyphs), and verify every check passes and qc-ui finds no contrast or layout problem in light and dark screenshots

## 5. E2E and verification

- [x] 5.1 Run qc-e2e on this change (archive, restore, rename and move from the list, archived note page, six home cards) and loop dev fixes until the e2e suite passes
- [x] 5.2 Run every CLAUDE.md check, qc-ui and the verifier on this change, record results in `evidence.md`, and verify the verifier verdict is pass
