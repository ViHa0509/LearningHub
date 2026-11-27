# Tasks

Contract: `design.md` and `specs/agent-chat/spec.md`.

## 1. Backend
- [x] 1.1 `on_text` / `on_step` through `run_agent`, `tool_loop`, `AgentModel.complete`; streaming in `AnthropicChat` and `OpenAICompatibleChat`. Verify: pytest with fake clients (text deltas in order, tool call deltas joined, same `Turn` as without streaming).
- [x] 1.2 Streamed answer of `POST /api/agent/chat` (design 1-2). Verify: pytest for the event lines, `done` equal to `/chat`'s answer shape, error line on provider failure with nothing stored, 429/404 before the stream.

## 2. Frontend
- [x] 2.1 `api.chatStream`, `useAgentChat` live entry, `MessageList` live rendering. Verify: Vitest for growing text, step clearing the text, done, error; `npm run lint`, `npm run build`.

## 3. E2E and verification
- [x] 3.1 Fake LLM streams when `stream` is set; e2e for the spec scenarios. Verify: `npm run e2e` passes.
- [x] 3.2 Verifier report.
