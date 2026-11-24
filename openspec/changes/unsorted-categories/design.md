## Context

- `notes.node_id` decides where the list shows a note; Unsorted = no link or a missing node (`frontend/src/lib/grouping.ts`).
- Providers are resolved per agent with `resolve_chain` (`app/agent/resolve.py`); `AgentModel.complete` works for every provider type, including `claude-code` (text only, no tools).
- Note text is untrusted: the model sees it only inside `<untrusted_note_content>`.

## Decisions

1. **Column, not table.** `notes.category text null` (migration 0027, additive). A category is just a name shared by notes; no rows to keep in sync, rename is one `UPDATE ... WHERE user_id AND category = old`. Names compare case-insensitively when reused (the stored spelling of the first existing match wins).

2. **One completion, no tool loop.** `POST /api/notes/categorize` (header `X-LearningHub`) loads the user's unsorted, non-archived notes (newest 200; more are left as they are), numbers them 1..n, and sends one `complete` call to the `note-sorter` agent's chain with: the existing category names, and per note its number, title and the first 300 characters of its text inside `<untrusted_note_content>`. The model answers JSON `{"groups": [{"name": "...", "notes": [1, 4]}]}`. Numbers instead of ids keep the prompt short and stop the model from naming another user's note. Alternative: the agent loop with a tool; rejected, more calls and `claude-code` would need the MCP tool.

3. **Strict parsing of the answer.** Take the first JSON object in the text; names are whitespace-collapsed, 1-40 characters, at most 12 groups; unknown or repeated numbers are ignored; a note in no group gets no category (Other). An answer that does not parse is a 502 "The note sorter answered in an unexpected format" and changes nothing. Notes are updated in one commit. The answer `{ "grouped": n, "groups": k }`.

4. **Limits like a chat request.** The per-minute rate limiter and the shared daily count (never for the admin) run before the model is called; `ResolveError` and `ProviderError` answer like the chat route (shared provider: name, model, category only). Nothing from the prompt or answer is logged.

5. **The assistant picks a category.** `save_learned_note` gets an optional `category` (string, at most 40 characters after trimming; ignored when `node_id` is given). If an existing category of the user matches case-insensitively, its spelling is used. The assistant's instructions say: when no node fits, give a short general category (1-3 words); the tool description asks for a short general name (e.g. "Kubernetes", "Career"), and the case-insensitive reuse keeps repeats in one group. The tool result names the category used.

6. **List.** `groupNotes` returns `unsorted` as `{ category: string | null; notes: Note[] }[]`: named groups ordered by their newest note, then Other (null) last. With no category at all the Unsorted group looks as today (one plain list, no Other heading). The whole Unsorted section stays the drop target. The filter applies inside the groups.

7. **Rename.** `POST /api/notes/categories/rename {from, to}`: `to` trimmed, 1-40 characters; renaming into an existing name merges the groups; an unknown `from` is 404. The heading shows a rename button that opens an inline form with Save (disabled until changed) and Cancel; Enter saves, Escape cancels.

## Risks / Trade-offs

- [The model sees note text] → only the first 300 characters, inside the untrusted wrapper; it can only output names and numbers, and names are shown as text.
- [Re-running regroups everything, including names the user renamed] → said in the button's tooltip; renamed names are passed as existing names so the model tends to keep them.
- [200 notes cap] → the rest stay as they are; a second click handles notes that became newest.

## Migration Plan

One additive column. Rollback: drop the column.
