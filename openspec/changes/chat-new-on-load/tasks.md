# Tasks

## 1. Frontend

- [x] 1.1 `useAgentChat.ts`: no browser memory of the open chat (remove the `lh.agent.session` storage and the restore on mount; `loading` starts false); `HistoryList.test.tsx`: replace the "survives a reload" block with tests for "Reload starts a new chat" and "The old chat is in History"; verify with `npm test`, `npm run lint`, `npm run build`

## 2. E2E and verification

- [x] 2.1 qc-e2e: scenario "Reload starts a new chat" + "The old chat is in History" in the chat history e2e file; fix any existing e2e that expects the chat to come back after a reload; `npm run e2e` passes
- [x] 2.2 Every check in `CLAUDE.md` passes, `openspec validate chat-new-on-load --strict` passes; verifier report
