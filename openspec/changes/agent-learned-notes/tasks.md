# Tasks

Implement after `learning-fields` is in (it changes the same catalog and agent files).

## 1. Backend

- [x] 1.1 Migration: `notes.source` text not null default 'import'; `NoteOut.source`; backup/restore keep it; verify with migration and backup tests
- [x] 1.2 Server-side page from Markdown (fixed template, styles inline in the page, HTML in the text escaped); tool `save_learned_note` (dedupe rules, node link validated against the user's catalog, stored through the file store, `source` agent); the assistant's instructions say when to use it; the chat answer's `changed` info refreshes the list; verify with tests for every scenario of the agent-chat delta

## 2. Frontend

- [x] 2.1 `lib/grouping.ts` order by last update (groups, domains; Unsorted last) and the agent badge; verify with Vitest for "Newest first" and the badge

## 3. E2E and integration

- [ ] 3.1 e2e with the fake LLM (a trigger that calls `save_learned_note`): asking about a new topic adds a note at the top with the badge; asking again adds none; screenshots; `npm run e2e` passes
- [ ] 3.2 Every check in `CLAUDE.md`, `openspec validate agent-learned-notes --strict`; verifier report
