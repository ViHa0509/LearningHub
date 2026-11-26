# Tasks

Contract: `design.md`, `specs/learning-views/spec.md`, `specs/agent-chat/spec.md`.

## 1. Backend

- [x] 1.1 (main session) Migration 0027: `notes.category` text null; `Note.category`; `NoteOut.category`; backup `NoteRow.category` (optional, older backups restore with none) (design 1). Verify: migration test up and down; backup round-trip keeps the category and an old backup without it restores.
- [x] 1.2 `note-sorter` AgentDef (no tools) and `POST /api/notes/categorize`: unsorted non-archived notes of the user (newest 200), numbered prompt with the untrusted wrapper, one `complete` call, strict parsing, one commit, rate limit and shared count, errors like the chat route (design 2-4). Verify: pytest per scenario of "Group unsorted notes with AI" with an injected fake model (good answer, unreadable answer, unknown numbers ignored, no provider, isolation between two users, admin not counted, header required).
- [x] 1.3 `POST /api/notes/categories/rename` (design 7). Verify: pytest (rename, merge, 404 unknown, length checks, isolation, header required).
- [x] 1.4 `save_learned_note` `category` (design 5) and the assistant's instructions. Verify: pytest per scenario of "A note the assistant saves without a topic gets a category"; `fake_llm.py` can save a note with a category and answer the note sorter.

## 2. Frontend

- [x] 2.1 `groupNotes` unsorted sub-groups, `LearnedList` sub-group headings, Group with AI button (busy state, error), rename form (Save/Cancel rules), `api.ts`. Verify: Vitest per scenario of the three learning-views requirements; `npm run lint`, `npm run build`.

## 3. E2E and verification

- [x] 3.1 qc-e2e: Group with AI through the fake LLM, rename a group, move a categorized note to a node, assistant saves a note with a category; screenshots light, dark and phone. Verify: `npm run e2e` passes.
- [x] 3.2 qc-ui inspects the new screenshots. Verify: no open defect, or each is listed in `evidence.md`.
- [x] 3.3 Every check in `CLAUDE.md` passes and `openspec validate unsorted-categories --strict` passes. Verify: verifier report in `verifier-report.md`.
