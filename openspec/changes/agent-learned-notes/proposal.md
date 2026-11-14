# Proposal

## Why

When the user asks the agent about something they have never recorded, such as gRPC, the explanation stays in the chat and never reaches the Learned list. The owner wants the agent to add such new topics to the Learned list by itself, and the list ordered by when items were last updated (2026-11-14).

## What Changes

- **Agent saves new topics as notes.** When the user asks to learn or explain a topic that has no note and no lesson yet, the assistant saves a learned note with tool `save_learned_note(title, markdown, node_id?)`: a short write-up (plain Markdown, the lesson outline: Overview, Key ideas, Example, Key takeaways, Sources when it used any). The app turns the Markdown into an HTML page with a fixed template on the server (the model never writes HTML), stores it like an imported note, links it to the closest existing roadmap node when one fits, else leaves it Unsorted, and the answer names the saved note.
- **No duplicates.** The tool refuses when a note with the same title (case-insensitive) already exists, or the node already has notes or a lesson; then the agent answers without saving.
- **Agent-made notes are marked** with source "agent" in the list (a small badge) so the user can tell them from imported pages; they can be renamed, moved, archived and deleted like any note.
- **Learned list order.** Inside each node group notes are newest first by their last update; groups and domains are ordered by their most recently updated note (most recent first); Unsorted stays last.

Not in this change: creating new roadmap topics for such notes (a topic like gRPC is added with the topic editor of `learning-fields`), a switch to turn auto-saving off.

## Capabilities

### New Capabilities

### Modified Capabilities
- `agent-chat`: new requirement "The assistant saves new topics as learned notes".
- `learning-views`: "Learned-items list" order by last update.

## Impact

- Backend: `notes` gains `source` (`import` default, `agent`) in migration (next number after learning-fields'); tool and handler in `app/agent/tools.py`; Markdown-to-HTML page with the template (server side, no raw HTML from the text: escape, or Markdown with HTML disabled).
- Frontend: list ordering in `lib/grouping.ts`, agent badge in `LearnedList.tsx`.
- Tests: tool cases (save, duplicate refused, node link, HTML escaped), grouping order, e2e with the fake LLM.
