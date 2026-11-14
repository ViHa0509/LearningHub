# Tasks

## 1. Backend

- [x] 1.1 Turn carries searches, sources and the raw blocks; `AnthropicChat.complete(..., web_search=True)` adds the web search tool (version by model), reads `server_tool_use` and `web_search_tool_result`, continues `pause_turn` at most 3 times; the chain passes the switch only to a model that supports it; the tool loop adds the search steps, lists the sources and sends the raw blocks back; verify with `tests/test_anthropic_web_search.py` (7 cases), backend lint, format check, `mypy app`, pytest

## 2. Frontend

- [x] 2.1 Settings → Agents note: "needs a Claude Code or Anthropic provider"; Anthropic providers get the description; verify with `SettingsPage.test.tsx` and `e2e/agent-web-search.e2e.ts`

## 3. Integration

- [ ] 3.1 Every check in `CLAUDE.md` passes, `openspec validate anthropic-web-search --strict` passes; a real search with an Anthropic key on the hosted app is checked by the owner; verifier report (`ai-sdlc-kit:verifier`) on the change
