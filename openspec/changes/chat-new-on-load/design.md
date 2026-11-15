# Design

`frontend/src/components/agent/useAgentChat.ts`:

- Remove `SESSION_KEY`, `readSession`, `saveSession` and the `restore` effect. `sessionId` stays React state only (`setSession` keeps the ref and the state, nothing else). `localStorage` key `lh.agent.session` is no longer read or written; an old value left by a previous build is ignored (do not bother removing it).
- `loading` starts `false` (nothing to restore), so the composer is ready at once on load.
- History → open, New chat, forget (session deleted elsewhere → `chat session not found` → empty chat) keep their behaviour.

Tests (`HistoryList.test.tsx`): the describe block "the open chat survives a reload" is replaced by "a page load starts a new chat": after a chat with one answer, unmount and render again → the panel shows no messages, New chat is disabled, the composer is enabled (nothing focuses it on load: focus stays where the opened page puts it), no request for the old session is made, and the old chat is listed in History and opens from there with its messages; sending after the reload creates a second session (`session_id` undefined in the request). Other tests that assert the `lh.agent.session` storage drop those assertions (the storage is gone).

E2E: in the chat history e2e file, a scenario "Reload starts a new chat": chat once, reload, the conversation log is empty and the composer enabled; open History, the chat is listed, open it, the answer is shown.
