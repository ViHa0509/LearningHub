## Why

The chat panel is a plain provider dropdown, a textarea and a Send button. The approved design (canvas "Knowledge Hub Agent Chat") turns it into a focused learning chat. It adds an agent menu, clearer messages, a toolbar with attachments, skills and effort, and a better input. It must stay on the app's existing conventions: the `index.css` tokens in light and dark, the `Icon` set, plain React components, the Save rule, untrusted content handling, and `X-LearningHub` on writes.

## What Changes

- **Header:**
  - Collapse, plus an agent menu that lists the agents defined in code (Learning assistant, Lesson writer) and chooses who answers the chat.
  - Clear chat, plus a Settings link.
  - The "nothing configured" state stays.
- **Messages:**
  - The user's messages are right-aligned bubbles; agent answers are left-aligned with an avatar.
  - Markdown supports tables (GitHub-flavoured, still no raw HTML), and code blocks get a Copy button.
  - Under each answer: Copy, Retry, and a caption with the provider · model · effort, plus the tool trace.
  - A failed request is shown as its own row with Retry, not inside the user's bubble.
  - An empty chat shows starter questions.
- **Toolbar above the input:**
  - **Attach:** text files only (Markdown, plain text, code, JSON, YAML, CSV). At most 5 files of 100 KB each, read in the browser and sent with the message.
  - **Skills (`/`):** a popup of skills (/summarize, /explain, /quiz, /rewrite, /mindmap, /flashcards). Typing `/` at the start of the input opens an autocomplete that filters as you type.
  - **Effort:** Low, Medium or High (remembered in the browser).
  - **Provider picker:** the existing per-chat provider override, restyled as a compact control.
- **Input:**
  - A rounded multi-line box with file chips (name, size, remove; a clear error for an unsupported or too-large file).
  - Send as an icon button with the accessible name "Send". Dropping files onto the panel attaches them.
- **Backend: `POST /api/agent/chat` takes two new optional fields.**
  - `effort` (`low` | `medium` | `high`, default `medium`): it sets the tool-step budget (low 3, medium the setting, high twice the setting up to 12) and adds one line to the instructions (answer briefly / thoroughly).
  - `attachments` (up to 5 `{name, text}`, each up to 100 000 characters): added to the last user message inside `<attached_file name="…">`, and treated as data like note content.
- **Not in this change (each needs its own design):**
  - Stop while generating (needs streaming answers).
  - PDF and image attachments (need file parsing or vision support).
  - Per-message model choice beyond the existing provider override.

## Capabilities

### New Capabilities

### Modified Capabilities
- `agent-chat`: the chat panel layout and controls. The chat request carries effort and attachments. Attached text is data.

## Impact

- **Backend:**
  - `app/routes/agent.py` (request fields)
  - `app/agent/loop.py` (effort line, attachment wrapping, safety text)
  - tests
- **Frontend:**
  - `AgentPanel.tsx`, split into small components: header, message, composer, skills popup, effort control, attachment chips
  - new `lib/skills.ts` and `lib/attachments.ts`
  - `api.ts`, the fake API, CSS on existing tokens, and Vitest tests
- **New dependency:** `remark-gfm` (Markdown tables), bundled through npm like the others. No CDN.
- **E2E:** the chat tests are updated to the new controls, keeping the existing accessible names.
