# Proposal

## Why

The owner wants lesson pages to look like the imported research pages (styled sections, highlights) without the model generating that layout again for every lesson, which would cost tokens each time (2026-11-14). The agent should also spend fewer tokens in general.

## What Changes

- **Lesson template in the app**: a lesson's Markdown is shown with a reading time, an "On this page" contents box, each `## ` section as a numbered card, a "Key takeaways" section as a highlighted card, GitHub-style alerts (`> [!KEY]`, `[!TIP]`, `[!WARNING]`, `[!NOTE]`) as callouts, tables (GitHub Markdown) in a framed scroll box, and code blocks with a Copy button. Raw HTML in the text is still never rendered.
- **Fixed outline for the lesson writer**: its instructions name the sections in order (Overview, Key ideas, How it works, Example, Common pitfalls, Key takeaways, Sources), a length of about 500 to 900 words, at most two callouts, and no HTML or CSS. The layout is never written by the model.
- **Prompt caching on Anthropic providers**: each request asks Anthropic to cache its prefix (tools, system prompt, conversation), so the steps of one agent run and the next message within a few minutes read it from the cache. Internal default; a provider configuration can turn it off.
- Printed lessons (Export PDF) keep the cards and callouts, without the contents box or Copy buttons.

Not in this change: a template for notes (imported pages keep their own HTML), saved chats as pages.

## Capabilities

### New Capabilities

### Modified Capabilities
- `lesson-pages`: "Lesson content is rendered safely" covers the template; "Ask the agent to draft an empty lesson" covers the outline.
- `agent-providers`: new requirement "Prompt caching on Anthropic providers".

## Impact

- Frontend: new `components/LessonBody.tsx` and `lib/lessonTemplate.ts`, `components/LessonPage.tsx`, `index.css`.
- Backend: `app/agent/agents.py` (LESSON_TEMPLATE), `app/agent/llm/adapters.py` (`cache_control`).
- Tests: new `LessonBody.test.tsx`; `test_llm_adapters.py`, `test_agent_providers_api.py`.
- Development: `CLAUDE.md` gets the token rules for coding sessions (kit agents by model, where to start the session).
