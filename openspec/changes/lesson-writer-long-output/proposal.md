# Proposal: lesson-writer-long-output

## Why

"Draft this lesson (o-to-hang-b/chuong-1)" stopped after 6 steps: the writer found no notes and no references (a learning-field area has none), then called `write_lesson` four times and each call failed with `'markdown' must be a non-empty string`.

Cause (read in the code, 2026-11-15): the Anthropic adapter sends `max_tokens` 2048 by default (`adapters.py:18`). A lesson of 500 to 900 words in Vietnamese inside one tool argument is longer than that, the answer stops with `stop_reason: max_tokens`, the cut-off `tool_use` block arrives with an empty input (`adapters.py:108`), the tool refuses, and the model tries the same again until the step budget is spent. Two things are missing: enough room for a lesson, and a clear message back to the model when its answer was cut.

Beside that, the writer's instructions assume references exist. A new area has none, so the writer needs a next step: search the web when the agent's Internet search is on, else write from what it knows and say so.

## What Changes

- Default `max_tokens` for Anthropic rises to 8192; the OpenAI-compatible adapter keeps sending none unless configured (its default is the provider's).
- A turn that stopped because of the output limit is marked (`Turn.truncated`). The loop does not run its tool calls: each gets a tool error "The answer was cut off by the output limit (N tokens). Make the call shorter, or ask the admin to raise max_tokens in the provider configuration." and the step is listed with that summary. A truncated answer without tool calls is returned with a note that it was cut.
- A tool call repeated with the same name, input and error is answered once more and then the loop stops with the stopped reply: the model does not spend the budget on one failing call.
- Lesson writer instructions: with no notes and no references, search the web when Internet search is on for the writer (2 to 4 trustworthy sources: official bodies, laws and regulations, textbooks, reference works), and cite them in Sources; without search, write from its own knowledge and say in Sources that no source was used. Never call `write_lesson` without the full text.

## Capabilities

### Modified Capabilities
- `agent-chat`: output-limit handling in the agent loop; lesson writer without references.

## Impact

- Backend: `agent/llm/adapters.py`, `agent/messages.py`, `agent/loop.py`, `agent/agents.py`, `agent/results.py`; tests `test_llm_adapters.py`, `test_agent_chat.py` (fake model with `truncated`), `test_anthropic_web_search.py` unchanged.
- The Claude Code provider type runs its own loop and is unchanged.
- e2e: the fake LLM server gets a scripted truncated turn to drive one scenario.
