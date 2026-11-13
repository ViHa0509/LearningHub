# Proposal

## Why

The agent chat lives only in the browser's memory: a reload, a sign-out or Clear chat loses the conversation, and nothing said to the agent can be read again later. The user wants to look back at past chats and pick one up where it stopped.

## What Changes

- Every chat is saved on the server as a **chat session** of the signed-in user: the user's messages (as typed and as sent), the answers, each answer's tool trace, provider, model, effort and fallback mark, and the names of attached files (not their text).
- `POST /api/agent/chat` takes an optional `session_id`. Without it a new session is created, titled from the first message; with it the server uses the stored conversation as the history and the request carries only the new message. The answer names the session and the two stored messages. A failed request stores nothing.
- Retry of an answer in a stored session replaces the conversation from that question on (`retry_from`), as the panel does today in memory.
- New routes under `/api/agent/sessions`: list (newest first), read one with its messages, rename, delete.
- Chat panel: a **History** button opens the list of past chats (title, time, message count) with Rename and Delete; choosing one shows it and the next message continues it. **New chat** replaces Clear chat: it starts an empty conversation and keeps the old one in History. After a reload the panel reopens the chat that was open.
- Backup, restore and sync carry the chat history; a backup made before this change still restores.
- Per-user isolation as for notes and lessons: another user's session id answers 404; deleting a user deletes their chats.

Not in this change: search inside past chats, sharing or exporting a chat, streaming, storing attachment text, automatic deletion of old chats, a model-written title.

## Capabilities

### New Capabilities
- `chat-history`: stored chat sessions per user - saving turns, listing, reopening, continuing, renaming and deleting them, and their isolation between users.

### Modified Capabilities
- `agent-chat`: the "Chat panel" requirement - the header gets New chat and History instead of Clear chat.
- `data-sync`: "Download a backup" and "Restore a backup" - the archive holds the chat history; an archive without it still restores.

## Impact

- Database: migration `0014` adds `chat_sessions` and `chat_messages` (RLS on by the existing lock-down in `alembic/env.py`).
- Backend: `app/db.py`, `app/routes/agent.py` (chat request and answer), new `app/routes/chat_sessions.py`, `app/data_sync/backup.py` and `restore.py`, `app/main.py` (router).
- Frontend: `api.ts`, `components/agent/useAgentChat.ts`, `AgentHeader.tsx`, `AgentPanel.tsx`, new `components/agent/HistoryList.tsx`, `test/fakeApi.ts`, `index.css`.
- Tests: backend API, isolation, migration and backup tests; Vitest for the panel; `agent-chat.e2e.ts` (Clear chat becomes New chat) and a new `chat-history.e2e.ts`.
- API compatibility: a chat request without `session_id` keeps working and keeps its meaning (the request's messages are the conversation); the answer only gains fields.
- `CLAUDE.md`: the per-user tables list gains the two tables.
