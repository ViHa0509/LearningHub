# Tasks

## 1. Backend

- [x] 1.1 `Turn.truncated` set by `from_anthropic` (`stop_reason == "max_tokens"`) and `from_openai` (`finish_reason == "length"`); Anthropic default `max_tokens` 8192; verify with `test_llm_adapters.py`
- [x] 1.2 Loop: tool calls of a truncated turn are not run and get the output-limit error as result and step summary; a cut final text gets the note; a tool call repeated with the same input and error stops the run after the second repeat; verify with `test_agent_chat.py` (fake model) for every scenario of "An answer cut by the output limit" and "A failing call is not repeated without end"
- [x] 1.3 Lesson writer instructions for a topic without notes and references (web search on / off); verify with a test that the instructions name both cases

## 2. E2E and verification

- [x] 2.1 qc-e2e: the fake LLM server (`frontend/e2e/fake_llm.py`) answers one scripted turn with `stop_reason: max_tokens` and an empty `write_lesson` input; the chat shows the cut-off step and no lesson is written; `npm run e2e` passes
- [x] 2.2 Every check in `CLAUDE.md` passes, `openspec validate lesson-writer-long-output --strict` passes; verifier report
