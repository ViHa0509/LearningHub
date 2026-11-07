## Why

The Learned list only grows: a note can be renamed or moved from its note page, but not from the list, and the only way to get an old or finished note out of the way is to delete it. The user also keeps most of what they learn in Knowledge Hub (KH), and much of it is about AI and agentic engineering, a field none of the five roadmaps covers, so those notes would all land in "Unsorted".

## What Changes

- Archive a note: it leaves the Learned list, the map markers, the home-page progress and the agent's searches, and appears in a collapsed "Archived" section at the bottom of the list, where it can be restored or deleted. Its note page shows that it is archived and offers Restore.
- Edit from the list: each list item gets a "More actions" menu with Rename (inline), Move to node (node picker, including Unsorted) and Archive. Clicking the item itself still opens the note.
- The notes API accepts `archived` in the update call and lists archived notes on request; archived notes are excluded by default.
- A sixth hand-written roadmap, **AI Engineer** (`ai-engineer`, order 6): LLM basics, retrieval, agents, the agent harness (hooks, subagents, skills), AI-driven SDLC, evals and AI security.
- Not code, done after this change ships: the user's learning items from KH are written as HTML notes, imported, and linked to roadmap nodes. That uses the existing import and link APIs only.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `knowledge-import`: notes can be archived and restored; listing excludes archived notes unless asked.
- `node-linking`: queries by node, unsorted lists and per-domain counts ignore archived notes.
- `learning-views`: the Learned list gets per-item actions (rename, move, archive) and an Archived section; the note page shows archived state.
- `roadmap-catalog`: ships six roadmaps, adding AI Engineer.
- `home-page`: six cards; progress ignores archived notes.
- `agent-chat`: the agent's note search does not return archived notes.

## Impact

- Database: Alembic migration 0005 adds a nullable `archived_at` column to `notes`.
- Backend: `routes/notes.py`, `routes/domains.py` (counts and `learned_nodes`), the agent's `search_notes` tool, schemas.
- Frontend: `LearnedList`, `NoteView`, `api.ts`, hooks, fake API; new e2e scenarios.
- Roadmaps: new `roadmaps/ai-engineer.yaml`; shipped-roadmap tests list six domains.
- No change to the import format, sandboxing or the provider settings.
