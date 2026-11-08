## Decisions

- **Existing conventions win over the canvas when they differ.**
  - **Colours** come only from the `index.css` tokens (`--surface`, `--surface-2`, `--border`, `--accent`, `--secondary`, `--muted`…), so light and dark both work. The canvas hexes are the dark-theme values of those tokens. A new token is added to `:root` and both dark blocks, never as a raw hex in a rule.
  - **Icons** come from `Icon.tsx`. New glyphs are added there with the same 1.5 px stroke.
  - **Accessible names** the e2e suite relies on stay as they are: "Message the agent", "Send", "Clear chat", "Provider", "Conversation", "Agent is working…", "Used N tools", and errors with `role="alert"`.
- **The agent menu** sets `agent_id` for chat messages. The Lesson writer keeps its own provider assignment (the provider override applies to the assistant only, as today). "Draft with agent" requests still name their agent.
- **Skills are frontend templates** (`lib/skills.ts`): `{cmd, label, description, prompt}`. The message sent is the skill prompt followed by the user's text. The bubble shows what the user typed (`/quiz JWT`). History sends the expanded text, so a retry repeats the same request.
- **Attachments:**
  - The browser reads the file with `File.text()` only when its extension is on the text allow-list and it is at most 100 KB.
  - The backend wraps each file as `<attached_file name="…">…</attached_file>` after the user's text in the LAST user message only. The file name is sanitized: no quotes, `<` or `>`, at most 120 characters.
  - The safety paragraph of the system prompt covers `<attached_file>` like `<untrusted_note_content>`.
  - Attachments are not resent as history in later turns (only the expanded message text is), to keep requests small.
- **Effort** is provider-neutral: a step budget plus one instruction line. Low: "Answer briefly; use tools only if needed." High: "Be thorough: check the relevant notes before answering, and explain step by step." Medium adds nothing. The budget is low 3, medium `agent_max_steps`, high `min(2 × agent_max_steps, 12)`. The caption shows the effort used.
- **Markdown:** `react-markdown` + `remark-gfm`, still without `rehype-raw`. Code blocks render through a small `CodeBlock` with a Copy button (`navigator.clipboard`, guarded).
- **Retry** resends the user's message, and its attachments still held for that turn, without the failed entry in the history.
- **No new global state:** the effort choice is kept in `localStorage` (guarded with try/catch), like the provider choice.

## Risks

- Attached text makes requests larger. The limits (5 × 100 KB) and the rate limiter bound this.
- Prompt injection through attached files: it is handled like note content (data markers plus the system instruction). The agent's tools cannot delete or overwrite a user-written lesson anyway.
