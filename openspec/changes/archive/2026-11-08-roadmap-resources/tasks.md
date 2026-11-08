## 1. Backend

- [x] 1.1 Mapping loader `app/resources/mapping.py`, validated against the catalog at startup; `roadmaps/sources/frontend.yaml`
- [x] 1.2 Link parser `app/resources/parser.py` (link lines only) with tests on a synthetic fixture
- [x] 1.3 `NodeResource` model and migration `0007_node_resources` (up and down tested)
- [x] 1.4 Sync `app/resources/sync.py`: tree listing, raw files (4 at a time), slug validation, one-transaction replace, in-memory job status; `app/sync_resources.py` command; settings for base URLs
- [x] 1.5 Routes: `GET /api/resources/{domain}/{node}`, `POST /api/resources/sync` (header, 202), `GET /api/resources/sync/{domain}`; tests with a fake HTTP server
- [x] 1.6 Safe fetch `app/resources/fetch.py` (stored URL only, types, schemes, YouTube, DNS check of every hop, pinned connection, size, time, content type, text extraction) with its own test file
- [x] 1.7 Agent tools `list_node_resources` and `fetch_reference`; safety text covers `<untrusted_reference_content>`; lesson writer instructions mention references

## 2. Frontend

- [x] 2.1 `api.ts` and fake API for resources and sync
- [x] 2.2 References section on the lesson page (groups, links with `noopener noreferrer`, source line, empty state with Sync and progress, Draft lesson from references); CSS on tokens
- [x] 2.3 Vitest for the lesson page scenarios

## 3. Checks

- [x] 3.1 License check: no roadmap.sh text or links in the repo (`git grep` over code, tests and fixtures)
- [x] 3.2 qc-e2e: References from a seeded database (synthetic links), empty state and Sync against a fake source; loop until the suite passes
