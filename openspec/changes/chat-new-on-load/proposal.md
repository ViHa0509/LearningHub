# Change: A page load starts a new chat

## Why

The agent panel remembers the open chat in the browser and shows it again after a reload. The owner wants the opposite (2026-11-16): every page load starts with a fresh, empty chat; a past chat is reached through History when needed.

## What changes

- The panel no longer remembers the open chat across page loads: after a reload it is empty, in the New chat state, with the composer ready.
- The previous chat is still on the server and listed in History; opening it from History continues it as today.
- Within one page life nothing changes: sending, History, New chat, retry, rename, delete.

## Impact

- Spec: `agent-chat` (new requirement "A page load starts a new chat").
- Frontend only: `frontend/src/components/agent/useAgentChat.ts` (remove the browser memory of the open session), `HistoryList.test.tsx` (the "survives a reload" block is replaced by tests of the new behaviour), e2e.
- No backend change; `chat_sessions` untouched.
