## Why

Lesson pages have only the user's own notes and lesson text. roadmap.sh curates reading links (official docs, articles, videos, courses) for every topic. Showing them on the matching lesson node, and letting the agent draft a lesson from them, makes each node a starting point for study. This follows the agreed contract `Learning-hub-handoff/roadmap-sh-resources/CONTRACT.md` (with its amendments in section 10b).

## What Changes

- **Mapping:**
  - New `roadmaps/sources/<domain>.yaml` maps each app node to roadmap.sh node slugs (`<roadmap>/<slug>`, or `<roadmap>/*`), pinned to a commit.
  - Only ids and slugs are in it, so it is committed.
  - It is validated at startup against the catalog. Slugs are validated during sync.
  - `frontend` comes first.
- **Sync:**
  - `python -m app.sync_resources --domain frontend` and `POST /api/resources/sync {domain}` (needs `X-LearningHub: 1`) → 202, running as a background job.
  - `GET /api/resources/sync/{domain}` → `{state, commit, nodes, links, error}`.
  - The sync reads the GitHub tree once, then the raw node files, 4 at a time, at the pinned commit.
  - It parses only the link lines, never the descriptions.
  - It replaces the domain's rows in one transaction at the end, so a failed sync keeps the old rows.
  - The base URLs are settings (`LH_ROADMAP_API_BASE`, `LH_ROADMAP_RAW_BASE`).
- **Storage:** new table `node_resources` (Alembic `0007`), unique `(node_id, url)`. The synced data lives only in the local database (roadmap.sh license: personal use, never published or committed).
- **API:** `GET /api/resources/{domain}/{node}` → `{node_id, source, commit, synced_at, source_url, items[]}`.
  - Items are ordered by type (official, course, book, article, opensource, video, roadmap, podcast), then by title.
  - An unknown node gets 404. A node not synced yet gets an empty list.
  - `source_url` is `https://roadmap.sh/<roadmap>`; no node-level URL, since that format is not verified.
- **Lesson page:**
  - A **References** section, grouped by type. Links open in a new tab with `rel="noopener noreferrer"`. It ends with "Source: roadmap.sh" and the sync time.
  - An empty state with **Sync references**, showing progress until the sync finishes.
  - **Draft lesson from references**, which asks the lesson writer.
- **Agent tools:**
  - `list_node_resources(node_id)`.
  - `fetch_reference(node_id, url)`:
    - accepts only a URL stored for that node, with type official or article
    - http(s) only; no credentials or cookies; 10 s timeout; 2 MB cap; `text/html` or `text/plain` only; at most 3 redirects, each checked again
    - refuses private, loopback, link-local and reserved addresses after DNS, and connects only to the address it checked
    - refuses YouTube
    - returns readable text (at most 20 000 characters) inside `<untrusted_reference_content>`, never stored
  - The lesson writer drafts with these tools and saves through `write_lesson`, which still never overwrites a user-written lesson.
- **Out of scope:**
  - other domains' mapping files (the same code works once they exist)
  - roadmap.sh node trees or descriptions
  - storing third-party page text
  - video transcripts
  - scheduled sync

## Capabilities

### New Capabilities
- `node-resources`: mapping, sync, storage, API, lesson-page References, and the agent's reference tools.

### Modified Capabilities

## Impact

- Backend:
  - `app/resources/` (mapping, parser, sync, safe fetch)
  - `app/routes/resources.py`, `app/sync_resources.py`
  - `app/db.py` + migration `0007`
  - `app/agent/tools.py` (two tools; the fetcher is injected)
  - `app/config.py`, `app/main.py`
- Frontend: `LessonPage.tsx` References section, `api.ts`, the fake API, CSS, tests.
- Tests use fake HTTP servers and synthetic links (`https://example.test/...`) only. Neither GitHub nor roadmap.sh is ever called in tests.
