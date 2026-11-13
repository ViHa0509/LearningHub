# Design

## Context

See proposal.md for the motivation. Today:

- `POST /api/agent/chat` (`backend/app/routes/agent.py`) is stateless: the browser sends the whole conversation (`messages`, at most 50) and gets one answer. Nothing about a chat is stored.
- The conversation lives in `useAgentChat` (`frontend/src/components/agent/useAgentChat.ts`) as `Entry[]` in React state. Failed questions stay visible but are not sent as history. Retry of an answer re-sends its question and drops everything after it. `clear` empties the state.
- Personal tables carry `user_id` (`user_fk()` in `app/db.py`); every query filters by the current user and another user's id answers 404. Migrations end with RLS on every public table (`alembic/env.py`), so new tables are locked down without extra work.
- Backup and restore (`app/data_sync/`) list their data files in `DATA_FILES`; `validate` refuses an archive that misses any of them or holds an unexpected entry.
- Backend routes are plain `def` with sync sessions; mutating calls need the `X-LearningHub: 1` header (`require_app_header`).

## Goals / Non-Goals

**Goals:**
- The server is the source of truth for a stored chat; the browser only remembers which one is open.
- A stateless chat request (no `session_id`) keeps its meaning, so existing tests, evals and API clients keep working.
- A reopened chat looks like it did: tool trace, provider, model, effort, fallback mark, attachment names.

**Non-Goals:**
- Search in past chats, export, sharing, streaming, a model-written title, automatic clean-up.
- Storing attachment text or the page the user was on.
- Summarising long histories; the window is the last 50 messages, as the request limit is today.

## Decisions

### 1. Two tables, messages owned through the session

`chat_sessions`: `id` uuid pk, `user_id` (`user_fk()`), `title` text, `created_at`, `last_message_at` (timestamptz). Index `(user_id, last_message_at DESC)`.

`chat_messages`: `id` uuid pk, `session_id` fk `chat_sessions.id` ON DELETE CASCADE, `position` int, `role` text (`user` or `assistant`), `content` text (the text sent as history), `display` text null (what the user typed; null for answers), `agent_id` text null, `attachments` jsonb (list of file names, default `[]`), `steps` jsonb (list of `{tool, input, summary}`, default `[]`), `stopped` bool, `provider_name` text null, `model_name` text null, `fallback_used` bool, `effort` text null, `created_at`. Unique `(session_id, position)`.

- Messages have no `user_id`: every message query joins or first loads the session filtered by `user_id`. One ownership check, no way for the two to disagree.
- `last_message_at` instead of an `updated_at` with `onupdate`: a rename must not move the chat in the list.
- Provider and model are stored as text, not a foreign key: the caption must survive deleting or renaming the provider.
- Alternative considered: one JSONB column holding the whole conversation. Rejected: every turn rewrites the row, retry and counts need to parse it, and a later search needs rows.

### 2. Chat request: `session_id` and `retry_from`

`ChatIn` gains `session_id: UUID | None` and `retry_from: UUID | None`; `ChatOut` gains `session: {id, title}`, `user_message_id`, `assistant_message_id`.

- No `session_id`: as today the request's `messages` are the conversation. After a successful answer a session is created and all request messages plus the answer are stored. (The panel sends one message here; other clients may send more.)
- With `session_id`: `messages` must hold exactly one user message (else 400). The conversation is the stored messages (last 50, starting at a user message) plus the new one. The session is loaded with `user_id == current user` first; missing answers 404 before the rate limiter and the model.
- `retry_from` needs `session_id` (else 400) and must be a user message of that session (else 404). The history sent to the model is the stored messages before it. On success the messages from that position on are deleted and the new turn appended, in the same transaction.
- Storing happens once, after `run_agent` returns, in one commit. A `ProviderError`, a rate-limit refusal or a crash stores nothing, so the panel's failed-question row stays a browser-only thing, as today, and its Retry is a plain send.
- Alternative considered: store the user message before calling the model and mark it failed. Rejected: it puts failed rows in the history sent later and needs a status column, for no user-visible gain.

Agent tools commit in the same SQLAlchemy session during the run (lessons). The chat rows are added after the run and committed separately; a failure to store the turn after a successful run answers 500 and does not undo a lesson the agent wrote.

### 3. API contract (all need a signed-in session; mutating ones need `X-LearningHub: 1`)

| Route | Request | Answer |
|---|---|---|
| `GET /api/agent/sessions?limit=50&offset=0` | `limit` 1-200 | `200 {sessions: [SessionSummary], total}` newest `last_message_at` first |
| `GET /api/agent/sessions/{id}` | | `200 SessionDetail`; `404 {detail: "chat session not found"}` |
| `PATCH /api/agent/sessions/{id}` | `{title}` | `200 SessionSummary`; `422` when the trimmed title is empty or over 120; `404` |
| `DELETE /api/agent/sessions/{id}` | | `204`; `404` |
| `POST /api/agent/chat` | adds `session_id?`, `retry_from?` | adds `session`, `user_message_id`, `assistant_message_id`; `400` for more than one message with a session or `retry_from` without one; `404` unknown session or message |

`SessionSummary = {id, title, created_at, last_message_at, message_count}`.
`SessionDetail = SessionSummary + {messages: [MessageOut]}`.
`MessageOut = {id, role, content, display, agent_id, attachments: string[], steps: [{tool, input, summary}], stopped, provider: {name, model} | null, fallback_used, effort, created_at}`.

Session routes live in a new `app/routes/chat_sessions.py`; storing a turn is a small module `app/agent/history.py` (`load_history`, `store_turn`) used by `routes/agent.py`, so the route stays readable.

Title: the first user message's `display` if given, else its `content`; whitespace collapsed, cut to 60 characters; `"New chat"` when empty or when the panel sent its files-only text. For that the request message gains an optional `display` (max 20 000) that the panel fills with the typed text; it is stored, never sent to the model.

### 4. Panel

- `useAgentChat` gains `sessionId`, `open(sessionId)`, `newChat()`; `clear` goes away. `Entry` gains `messageId?: string`. `send` passes `session_id` when set and stores the returned ids; `retry` of an answer passes `retry_from` with the question's `messageId` (a question without one, i.e. a failed one, is sent plainly).
- Opening a chat maps `MessageOut` to `Entry`: a user entry gets a `turn` with `display`, `content`, `agentId` and no file text; attachment names are shown as the read-only chips the message already shows.
- TanStack Query: `queryKeys.chatSessions` for the list (invalidated after every answered send, rename and delete), `queryKeys.chatSession(id)` fetched on open.
- `AgentHeader`: **New chat** (disabled while busy or when the conversation is empty and has no session) and **History** (toggle, `aria-pressed`) replace Clear chat. The narrow-panel rule that hides the Clear chat label applies to both.
- `HistoryList` replaces the message list and composer while it is open (the panel is narrow; a popover would not fit a rename field). Rows are buttons with `aria-current` on the open chat; Rename is an inline field with Save and Cancel (Save disabled until changed, Enter saves, Escape cancels); Delete uses the confirm pattern the app already uses for destructive actions. Choosing a row or pressing New chat closes the view. Switching is disabled while `busy`.
- The open chat's id is kept in `localStorage` (`lh.agent.session`), read on mount and wrapped in try/catch. A 404 on that read clears the key and starts a new chat silently. Sign-out does not need to clear it: another user gets the same 404.
- Requests from elsewhere in the app ("Draft with agent", "Ask the agent") go to the open chat, as today.

### 5. Backup and restore

- One new archive entry `data/chat_sessions.json`: a list of sessions, each with its messages nested and ordered. Manifest counts gain `chat_sessions` and `chat_messages`. `FORMAT` stays 1.
- The entry is optional on restore: `DATA_FILES` stays the required set, a new `OPTIONAL_FILES` is accepted by `_check_name`. Present: the user's sessions are replaced, with new session and message ids. Absent: chat tables are not touched. An archive from the new migration on an older server is already refused by the migration check.
- Validation of the entry: Pydantic rows with `role` limited to the two values, text lengths capped at the request limits, at most 50 steps per message; positions are rewritten 0..n-1 in list order.

## Risks / Trade-offs

- [Retry after a reload cannot re-send attached files, their text is not stored] → the reopened message shows the file names; Retry sends the stored text only. Accepted: storing up to 500 KB per turn is out of scope.
- [A very long chat costs tokens on every turn] → only the last 50 messages are sent, the same bound as today's request limit; no summarising.
- [Two tabs on one chat] → both append; `(session_id, position)` is unique, the second writer takes the next position by reading the maximum inside its transaction and retries once on a conflict. A tab shows the other's turns after it reopens the chat.
- [Stored answers may quote untrusted note text] → no change in trust: stored messages are sent back only as `user` and `assistant` history, exactly as the browser did, and are rendered through the same Markdown component (no raw HTML).
- [Chat text is personal data] → rows are per user, cascade on user delete, under RLS, never logged; the backup already is a personal archive.
- [Backup size grows] → text only; the 200 MB per JSON file cap applies and is far above realistic use.

## Migration Plan

1. Migration `0014_chat_sessions.py` creates both tables; downgrade drops them. No data backfill: chats that exist only in a browser's memory are not recovered.
2. Deploy as usual (CI migrates, then deploys). Old browsers with a cached bundle keep working: the stateless request is still valid; their chats start being saved as one session per request until the page reloads.
3. Rollback: deploy the previous version; the two tables stay unused, or downgrade to `0013`.
