## 1. Backend

- [x] 1.1 `ChatIn.effort` and `ChatIn.attachments` (limits, name sanitizing); `ChatOut.effort`
- [x] 1.2 Loop: step budget and instruction line per effort; attachments wrapped in the last user message; safety text covers `<attached_file>`
- [x] 1.3 Tests for the effort and attachment scenarios, including injection text and limits

## 2. Frontend

- [x] 2.1 `remark-gfm`; `lib/skills.ts`, `lib/attachments.ts` with unit tests; `api.ts` and fake API fields
- [x] 2.2 New icons in `Icon.tsx` (paperclip, send, copy, retry, settings, sparkle, sidebar) on the existing stroke style
- [x] 2.3 Panel split into header (agent menu, Clear chat, Settings), messages (bubbles, CodeBlock with Copy, caption, Copy and Retry, error row, starters), composer (toolbar: Attach, Skills, Effort, Provider; chips; drop target; Send)
- [x] 2.4 CSS on existing tokens only, light and dark
- [x] 2.5 Vitest for every scenario of the chat panel, skills, effort and attachment requirements

## 3. E2E

- [x] 3.1 qc-e2e: update the chat tests and add tests for the agent menu, skills, effort and attachments; loop until the suite passes
