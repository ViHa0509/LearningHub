## 1. Inline editing

- [x] 1.1 `lib/inlineEdit.ts`: mark editable blocks, build the frame copy with the editor script, apply edits and serialize without marks; unit tests
- [x] 1.2 Rewrite `NoteEditor`: the page in the sandboxed frame, a changed-block count, Save (Ctrl+S from the frame too), Cancel with a confirmation, collect and save the edits, messages only from its own frame
- [x] 1.3 Vitest for the editor (simulated frame messages)

## 2. E2E

- [x] 2.1 qc-e2e: update the editor tests in `note-edit.e2e.ts` to click into the page, type, save and check; loop until the suite passes

## 3. Found by e2e

- [x] 3.1 The MCP tool server imported the Anthropic and OpenAI SDKs through `llm/errors.py` (~15 s per Claude Code answer on Windows), so two claude-code e2e tests timed out under load: the SDKs are now imported only inside the classifiers, with a regression test
