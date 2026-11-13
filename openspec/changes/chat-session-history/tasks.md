# Tasks

## 1. Data model

- [x] 1.1 `ChatSession` and `ChatMessage` in `app/db.py` and migration `0014_chat_sessions.py` (tables, index, unique `(session_id, position)`, cascade from `users` and from the session; downgrade drops both) as in design.md decision 1; verify `test_migrations.py` passes with new cases: upgrade to head creates both tables with RLS on, downgrade to `0013` removes them, deleting a user deletes their sessions and messages

## 2. Backend: saving and continuing chats

- [x] 2.1 `app/agent/history.py` (`load_history`, `store_turn`, title rule) and `POST /api/agent/chat` with `session_id`, `retry_from`, message `display`, and the new answer fields, as in design.md decisions 2 and 3; verify with new tests in `test_agent_chat.py` for every scenario of "Chats are saved as sessions", "A stored message keeps what the panel shows", "Continue a session" and "Retry replaces the turn in the session" (injected fake model; assert the messages the model received and that a failed request stores nothing), and that the existing chat tests pass unchanged
- [x] 2.2 `app/routes/chat_sessions.py` (list, read, rename, delete) registered in `app/main.py`; verify with a new `test_chat_sessions.py` for every scenario of "List, read, rename and delete sessions" plus the status codes and error shapes of the contract table (404 detail text, 422 title, 204 delete, missing `X-LearningHub` header refused)
- [x] 2.3 Isolation: verify with new cases in `test_isolation_agent.py` for every scenario of "Chat sessions are separate per user" (read, rename, delete, continue and retry with another user's ids answer 404 and call no model; lists do not mix; 401 without a session)
- [x] 2.4 Add `chat_sessions` and `chat_messages` to the per-user tables line in `CLAUDE.md` (Conventions, Users); verify backend lint, format check and `mypy app` pass

## 3. Backup, restore and sync

- [x] 3.1 `backup.py`: `data/chat_sessions.json` with nested messages and the two manifest counts; `restore.py`: optional entry, validation, replace with new ids, untouched when absent (design.md decision 5); verify with new cases in `test_data_backup.py` and `test_data_sync.py` for "Chat history in the backup", "Restore replaces the chat history" and "Backup without chat history", plus an invalid chat entry (unknown role) refused with nothing changed and no key, token or attachment text in the archive

## 4. Frontend: chat state

- [x] 4.1 `api.ts` (types and calls for the session routes, new chat request and answer fields, query keys) and `test/fakeApi.ts` (in-memory sessions that follow the contract, including `retry_from` and 404s); verify `npm run build` passes and the existing Vitest suite passes
- [x] 4.2 `useAgentChat`: `sessionId`, `open`, `newChat`, `messageId` on entries, `session_id` and `retry_from` on requests, list invalidation, remembered chat in `localStorage` with the silent 404 fallback; verify with Vitest for "Reopen and continue" (request names the session and carries one message), retry of an answer (request carries `retry_from`), retry of a failed question (plain send), and both scenarios of "The open chat survives a reload"

## 5. Frontend: panel

- [x] 5.1 `AgentHeader`: New chat and History replace Clear chat (accessible names "New chat" and "History", icons added to the Icon set if missing, labels hidden in the narrow panel); `AgentPanel` wires them; update the Clear chat cases in `AgentPanel.test.tsx` and `e2e/agent-chat.e2e.ts` to New chat without weakening them; verify with Vitest for the "New chat" scenario of the Chat panel requirement
- [x] 5.2 `components/agent/HistoryList.tsx` and its styles in `index.css` (light, dark, phone drawer; rows, open-chat mark, empty state, inline Rename with Save and Cancel, Delete with confirm, switching disabled while busy); verify with a new `HistoryList.test.tsx` for every scenario of "History in the chat panel" and for keyboard use (Enter saves, Escape cancels, Save disabled until changed)
- [x] 5.3 A reopened chat renders like a live one (tool trace, provider, model, effort, fallback mark, attachment names, `/skill` text as typed); verify with a Vitest case in `MessageList.test.tsx` or `AgentPanel.test.tsx` that loads a stored session with each of these

## 6. E2E and integration

- [x] 6.1 `qc-e2e` writes `frontend/e2e/chat-history.e2e.ts` from the three spec deltas (first message creates a chat, reopen and continue, New chat, rename, delete the open chat, reload keeps the chat, another member sees none of the admin's chats, backup and restore carry the history) with light and dark screenshots of the History view; send each failure to the developer who owns the area and rerun until `npm run e2e` passes
- [ ] 6.2 `qc-ui` inspects the new screenshots (desktop, and the agent drawer on a phone); fix what it reports; verify its report has no open defect
- [ ] 6.3 Every check in `CLAUDE.md` passes and `openspec validate chat-session-history --strict` passes; verifier report (`ai-sdlc-kit:verifier`) on the change

## Workflow follow-up

- Archive `chat-session-history` after the verifier report.
- Backlog candidates left out here: search in past chats, export a chat, model-written titles.

## Notes from the implementation (2026-11-13)

- 2.1 to 2.3: the storing, session-route and isolation cases are in one new file, `backend/tests/test_chat_sessions.py`, instead of being spread over `test_agent_chat.py` and `test_isolation_agent.py`; the existing chat tests pass unchanged.
- 1.1: the index is `(user_id, last_message_at)` without DESC (Postgres reads it backwards for the newest-first list).
- 3.1: a restored message may hold up to 1 000 000 characters (an answer has no request limit, so the 20 000 cap of design.md would refuse the server's own backups); the typed text, file names and steps keep the request limits.
- 5.1: New chat and History are icon buttons at every width (accessible names "New chat" and "History"), not labelled buttons that lose the label in the narrow panel.
- 6.1: written and run by the main session (`qc-e2e` was not available). The scenario "another member sees none of the admin's chats" is covered in `backend/tests/test_chat_sessions.py`, not in e2e; e2e checks that a request without a session is answered 401.
- 6.2: the screenshots (`chat-history*.png`, desktop light and dark, phone drawer) were inspected by the main session, not by `qc-ui`.
- Not covered by a UI test: the History rows being disabled while the agent is working (the fake chat answers at once).
