# Evidence log: slice-1-import-and-map

What was checked, what failed, what fixed it, and which check caught it. Built 2026-11-06 by Claude Code (autonomous apply), with Kit v0 (`ai-sdlc-kit@petrus-sdlc` 0.1.0).

## End-to-end run (task 6.1)

Real backend (uvicorn, dev database) + Vite dev server, all requests through the `/api` proxy.

| Step | Result |
|---|---|
| Import three real Claude research pages (an AWS review, a VM deploy guide, Airflow notes) plus one of them again under another name | 3 x `created`, 1 x `duplicate` pointing at the first note |
| Link two notes (`devops/aws`, `devops/cloud`), leave one unsorted | Both PATCH calls return the node; third note unsorted |
| Restart the backend ("reload"), read back | `devops` counts `{aws: 1, cloud: 1}`, `backend` counts `{}`, unsorted list = the Airflow note |
| Download each original and compare with the source file (`cmp`) | All three byte-identical |
| Headers on an original | `Content-Security-Policy: sandbox allow-scripts`, `X-Content-Type-Options: nosniff` |
| Headless Edge screenshot of the app | List grouped as DevOps > Cloud providers / AWS, Unsorted; map, domain tabs and agent placeholder render |
| Headless Edge screenshot of an original page | Renders fully (Vietnamese text, styles) in the sandbox |

## Problems found and fixed

| What went wrong | Caught by | Fix |
|---|---|---|
| psycopg 3 async mode does not run on Windows' default Proactor event loop | Design review before coding the DB layer | Sync SQLAlchemy sessions and plain `def` routes; recorded in design.md and CLAUDE.md Conventions |
| Starlette TestClient warns that `httpx` is deprecated (`httpx2` required) | `pytest -W error` while checking a warning | Dev dependency switched to `httpx2` |
| Notes flashed under "Unsorted" until roadmaps loaded; the list remounted and clicks hit detached buttons | Failing Vitest test (NoteView tests could not open a note) | List renders only after all roadmaps are loaded |
| React Flow node clicks through `user-event` crash d3-drag in jsdom (`event.view` is null) | Unhandled error in Vitest | Map node clicks in tests use `fireEvent.click` |
| Map unreadable: 10 top-level topics laid out side by side, `fitView` shrank nodes to a few pixels | E2E screenshot (no unit test could see it) | Roadmap-style layout: topics on a vertical spine, subtopics branching right; dagre removed |
| Vite template now ships oxlint, not eslint; react-resizable-panels v4 needs real layout | Scaffolding / jsdom | oxlint kept; CSS grid with explicit collapse state |
| Ruff sorted the local `alembic/` folder as first-party | `ruff check` | `known-third-party = ["alembic"]` |

## Checks and verifier (task 6.2)

See the verifier report below (run with change name `slice-1-import-and-map`).

Verdict: **pass** (all six CLAUDE.md checks green, every checked task has evidence, no uncovered scenarios).

The verifier also flagged three things, all fixed before closing the change:

| Verifier note | Fix |
|---|---|
| design.md and task 5.3 still said the map used dagre | Artifacts updated to the spine layout |
| Tasks 1.4 and 6.2 still said eslint | Artifacts updated to oxlint |
| Task 3.1 claims `alembic downgrade base` works, but no test exercised it | Added `tests/test_migrations.py` (downgrade base -> upgrade head on the test DB); backend now 62 tests |

<details><summary>Full verifier report</summary>

## Verifier report: pass

### Checks
| Command | Exit | Result |
|---|---|---|
| `cd backend && .venv/Scripts/python -m pytest` | 0 | pass |
| `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .` | 0 | pass |
| `cd backend && .venv/Scripts/mypy app` | 0 | pass |
| `cd frontend && npm test` | 0 | pass |
| `cd frontend && npm run lint` | 0 | pass |
| `cd frontend && npm run build` | 0 | pass |

<details><summary>Output tails</summary>

**Backend tests**
```
.............................................................            [100%]
61 passed in 6.29s
```

**Backend lint**
```
All checks passed!
21 files already formatted
```

**Backend types**
```
Success: no issues found in 11 source files
```

**Frontend tests**
```
> learninghub-frontend@0.0.0 test
> vitest run

 RUN  v5.1.0 C:/Users/Petrus/Documents/Learning-hub/frontend

 Test Files  5 passed (5)
      Tests  21 passed (21)
   Start at  00:51:29
   Duration  7.18s (environment 51%, tests 24%, setup 13%, import 11%, transform 1%)

Environment  jsdom was created 5 times · 8.85s total, 51% of tracked time
             create it once per worker with pool: 'vmThreads' (keeps per-file isolation) or isolate: false (shares it across files)
             learn more: https://vitest.dev/guide/improving-performance#test-environments
```

**Frontend lint**
```
> learninghub-frontend@0.0.0 lint
> oxlint src
```

**Frontend build + types**
```
> learninghub-frontend@0.0.0 build
> tsc -b && vite build

vite v8.3.6 building client environment for production...
transforming...
✓ 92 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.46 kB │ gzip:   0.30 kB
dist/assets/index-Cw0N2VJy.css   20.54 kB │ gzip:   4.12 kB
dist/assets/index-7ZJUAtR_.js   454.06 kB │ gzip: 143.09 kB
✓ built in 297ms
```

</details>

### Task evidence (slice-1-import-and-map)
| Task | Status | Evidence |
|---|---|---|
| 1.1 .gitattributes, storage ignored | evidence found | `.gitattributes` has `* text=auto eol=lf`; `git check-ignore -v storage/blobs/x.html` matches `.gitignore:19:storage/` |
| 1.2 docker-compose Postgres | evidence found | `docker-compose.yml`; the backend tests ran against the `learninghub_test` DB |
| 1.3 Backend scaffold, health | evidence found | `backend/.env.example`; `backend/tests/test_health.py::test_health_returns_ok` |
| 1.4 Frontend scaffold | evidence found | `npm run build` and `npm test` pass (it uses oxlint, not eslint; see notes) |
| 1.5 Kit v0 (CLAUDE.md, REVIEW.md, verifier) | evidence found | `CLAUDE.md`, `REVIEW.md`; `.claude/settings.json` enables plugin `ai-sdlc-kit@petrus-sdlc` |
| 2.1 Hand-written roadmaps, 15-25 nodes | evidence found | `roadmaps/backend.yaml`, `roadmaps/devops.yaml`; `test_shipped_roadmaps_have_15_to_25_nodes` |
| 2.2 YAML validation stops startup | evidence found | `test_invalid_roadmap_names_file_and_node` (8 parametrized kinds), `test_app_refuses_to_start_with_invalid_roadmap` |
| 2.3 Domains and roadmap API | evidence found | `test_list_domains`, `test_read_roadmap`, `test_unknown_domain_is_404` |
| 3.1 notes migration up/down | evidence found | `backend/alembic/versions/0001_create_notes.py` (has `downgrade()`); `conftest.py` runs `command.upgrade(config, "head")`. Downgrade is not exercised (see notes) |
| 3.2 FileStore / LocalFileStore | evidence found | `backend/tests/test_storage.py` (round-trip byte-identical, content-addressed, delete, path escape) |
| 3.3 HTML extraction | evidence found | `backend/tests/test_extract.py`; fixtures `backend/tests/fixtures/redis-eviction.html`, `jwt-no-title.html` |
| 3.4 Import endpoint with per-file outcome | evidence found | `test_import_one_file`, `test_import_several_files_each_with_own_outcome`, `test_wrong_file_type_is_rejected`, `test_file_over_10_mb_is_rejected`, `test_empty_file_is_rejected`, `test_undecodable_file_is_rejected` |
| 3.5 List, read, rename, delete | evidence found | `test_list_is_newest_first`, `test_read_note_has_text_and_metadata`, `test_rename_keeps_original`, `test_delete_removes_note_and_original` |
| 3.6 Original served with CSP sandbox | evidence found | `test_original_is_served_sandboxed`, `test_original_is_byte_identical` |
| 4.1 Link, move, unlink, unknown node | evidence found | `backend/tests/test_linking.py`: `test_link_note`, `test_move_note`, `test_unlink_note`, `test_unknown_node_is_rejected_and_note_unchanged` |
| 4.2 `?node=` / `?unsorted=true` | evidence found | `test_notes_of_a_node`, `test_unsorted_notes`, `test_link_to_removed_node_is_kept_and_flagged` |
| 4.3 Domain counts | evidence found | `test_counts_for_a_domain`, `test_counts_unknown_domain_is_404` |
| 5.1 Three-pane layout, collapse | evidence found | `frontend/src/App.test.tsx`: "shows list, map and the reserved agent panel", "collapses and expands the left panel" |
| 5.2 Learned list | evidence found | `frontend/src/components/LearnedList.test.tsx` (grouping, missing-node, filter, empty state, roadmap order) |
| 5.3 Map with count markers, domain switcher | evidence found | `frontend/src/components/RoadmapMap.test.tsx` "marks nodes with notes with their count, matching the counts API", "switches domain". Dagre was removed, so the task text no longer matches the code (see notes) |
| 5.4 Two-way selection | evidence found | `App.test.tsx` "selecting a note shows its domain on the map...", "selecting a node highlights its notes in the list" |
| 5.5 Import from UI | evidence found | `frontend/src/components/ImportDialog.test.tsx` (import-and-link, skip-linking) |
| 5.6 Note view | evidence found | `frontend/src/components/NoteView.test.tsx` (sandbox without `allow-same-origin`, rename, relink/unlink, delete after confirmation) |
| 6.1 End-to-end run, evidence log | evidence found | `openspec/changes/slice-1-import-and-map/evidence.md` (manual run recorded; no automated test) |

Task 6.2 is unchecked. This report is its verifier step.

### Uncovered scenarios
- none

All 37 scenarios across the four spec files under `openspec/changes/slice-1-import-and-map/specs/` have a covering test. Examples of the mapping:
- roadmap-catalog "Node removed from YAML" and node-linking "Node removed" are covered by `test_link_to_removed_node_is_kept_and_flagged`.
- knowledge-import "Page with scripts is opened" is covered by `test_original_is_served_sandboxed` plus the NoteView iframe sandbox test.
- learning-views "Open a note" is covered by the NoteView test that asserts the frame, the title field and the link picker.

### Notes
- **Stale design artifacts:** task 5.3 and `design.md` (lines 96 and 120) still say the map layout uses `dagre`. The uncommitted change removes `@dagrejs/dagre` from `frontend/package.json` and replaces it with a spine layout in `frontend/src/lib/layout.ts`, as recorded in `evidence.md`. No spec scenario mentions dagre, but the change artifacts should be updated to match.
- **eslint vs oxlint:** task 1.4 and task 6.2 mention eslint, but the frontend uses oxlint (`npm run lint` runs `oxlint src`). This is recorded in `evidence.md`, but the task text is stale.
- **Migration downgrade not tested:** task 3.1 asks to verify that `alembic downgrade base` succeeds. `downgrade()` exists, but no test or evidence entry shows it was run. Only upgrade is exercised, via `backend/tests/conftest.py`.
- **Task 6.1 is manual:** its evidence is the manual log in `evidence.md`, so I could not reproduce it with a check.
- **Build output:** `npm run build` wrote `frontend/dist/` as part of the declared check. Nothing else in the working tree was changed.

</details>
