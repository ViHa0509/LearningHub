# Tasks

## 1. Providers (spec: agent-chat)

- [x] 1.1 Add provider settings (`SecretStr` keys, Ollama URL, step limit), `anthropic` and `openai` dependencies, and `.env.example` entries, and verify settings load from the environment without exposing keys
- [x] 1.2 Implement the neutral message types, the `ChatProvider` protocol, the Anthropic and OpenAI-compatible adapters (OpenAI, DeepSeek, Ollama) and a scripted `FakeProvider`, and verify unit tests that each adapter translates messages, tools and tool calls both ways with a stubbed SDK client
- [x] 1.3 Implement `GET /api/agent/providers`, and verify API tests for no provider, one provider, and that no key appears in the answer

## 2. Agent loop and tools (spec: agent-chat)

- [x] 2.1 Implement the tools (search, read note with untrusted wrapping, list roadmap, read lesson, guarded write lesson), and verify unit tests for each tool, its error results and the protected user lesson
- [x] 2.2 Implement the loop with step limit, trace and changed lessons, plus the system prompt with page context and the untrusted-content rule, and verify loop tests with the fake provider for answer-from-notes, step limit, tool error and page context
- [x] 2.3 Implement `POST /api/agent/chat` (400, 409, 502 cases), and verify API tests for every chat error scenario and a full tool round trip

## 3. Chat panel and lesson drafting (spec: agent-chat, learning-views, lesson-pages)

- [ ] 3.1 Rewrite `AgentPanel`: provider and model picker, conversation, Markdown answers without raw HTML, tool trace, Enter to send, clear, not-configured help and error display, and verify Vitest tests for the chat-panel scenarios
- [ ] 3.2 Add "Draft with agent" on empty lessons (only with a provider) and refresh lessons named in `changed_lessons`, and verify Vitest tests for drafting and for no provider

## 4. Evals and verification (spec: agent-evals)

- [x] 4.1 Add `backend/evals/` golden questions with the `live` marker, excluded from the default run, and verify they report skipped without a key and that the default `pytest` run does not collect them
- [ ] 4.2 Extend the e2e suite with the agent panel's not-configured state and the CLAUDE.md commands (eval command, settings), run every check, the UI QC agent and the verifier, record `evidence.md`, and verify the verifier verdict is pass
