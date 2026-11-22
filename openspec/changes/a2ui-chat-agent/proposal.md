# Proposal

## Why

The chat answers "quiz me", "practice" and "teach me" requests with plain text today (the `/quiz` skill even puts the answers right under the questions). The A2UI Lab (change `a2ui-lab-playground`) taught the protocol and built a safe renderer. The next step is to use it for real: the assistant hands these requests to an A2UI agent, and the chat shows an interactive quiz or lesson the user answers in place. This is the owner's first end-to-end agent-to-UI flow, the pattern they want to reuse in real projects.

## What Changes

- New agent `a2ui` ("Interactive tutor"), defined in code with its own provider assignment in Settings > Agents, like the other agents.
- New assistant tool `show_interactive` (kind `quiz`, `practice` or `lesson`, plus a topic). The assistant calls it when the user asks to be quizzed, to practise, or for a creative or interactive lesson. The tool runs the A2UI part on the server:
  - **practice** in an area with a question bank: questions are drawn from the bank, with no model call;
  - **quiz**, or practice with no bank: the `a2ui` agent reads the user's notes and lesson on the topic and fills a fixed quiz schema (questions, options, answer, explanation) through a tool;
  - **lesson**: the `a2ui` agent fills a fixed lesson schema (sections of concept, example, tip, and check-yourself questions) through a tool.
- The server turns that content into A2UI v0.9 messages from app-owned templates. **The model never writes layout or A2UI JSON.** Answer keys stay on the server; the messages sent to the browser carry no answers.
- The chat answer carries the surfaces; the chat panel renders them under the assistant's text with the A2UI Lab renderer (same catalog, media guard and Markdown rules).
- Answering a question sends an A2UI `action` to a new route. The server grades it against the stored key with no model call, records it (for bank questions, in the same practice history the Practice page uses), and answers with A2UI `updateDataModel` messages: right or wrong, the correct option and the explanation, and the score.
- Surfaces are stored with the chat message, so reopening a stored chat shows them with the answers already given.
- Security fix found while planning: model-written Markdown (chat answers, A2UI text and the Lab) must not load outside images (`![](https://…)`). That could leak note content to a third party through a prompt injection. Such images show as a link-text placeholder instead.
- Out of scope: the `claude-code` provider type for the assistant's `show_interactive` tool and for the `a2ui` agent (they run their own tool loop in a separate process); streaming; a model-written explanation per answer; interactive surfaces in the data backup (a restored chat shows the answer text only); flashcards or other kinds.

## Capabilities

### New Capabilities
- `a2ui-chat`: interactive surfaces in the agent chat: the `show_interactive` tool and when it is offered, the `a2ui` agent and its content schemas, building surfaces from templates, keeping answer keys on the server, grading actions, rendering and storing surfaces in the chat, and their safety rules.

### Modified Capabilities
- `agent-providers`: the agents defined in code now include `outline` (already in code but missing from the spec) and the new `a2ui` agent.
- `agent-chat`: model-written Markdown in chat answers does not load images from outside the app.

## Impact

- Backend:
  - `app/agent/agents.py` (new agent), `app/agent/tools.py` (`show_interactive` and the `a2ui` agent's tools), `app/agent/loop.py` and `app/agent/results.py` (surfaces in the result);
  - a new package `app/a2ui/` (content schemas, templates, grading);
  - `app/routes/agent.py` (surfaces in `ChatOut`), `app/routes/chat_sessions.py` (surfaces in stored chats), and a new route `app/routes/a2ui.py`;
  - `app/db.py` and migration `0023_a2ui_surfaces` (new table `a2ui_surfaces`, owned by a user and linked to a chat message, with RLS like every table).
- Frontend:
  - the chat panel (`agent/MessageList.tsx`, `useAgentChat.ts`) renders surfaces with the Lab's catalog and `LabMarkdown`;
  - `api.ts` types and the action call;
  - `markdownConfig.tsx` guards images.
- E2E: the fake LLM server (`frontend/e2e/fake_llm.py`) scripts `show_interactive` and the `a2ui` agent's tool calls.
- No new dependency.
