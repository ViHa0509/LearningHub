# Verifier report: a2ui-chat-agent

Verdict: **pass** (verifier subagent, 2026-11-22)

## Checks

| Command | Exit | Result |
|---|---|---|
| `cd backend && .venv/Scripts/python -m pytest` | 0 | pass (whole suite, one run) |
| `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .` | 0 | pass (`All checks passed!`, `212 files already formatted`) |
| `cd backend && .venv/Scripts/mypy app` | 0 | pass (`no issues found in 102 source files`) |
| `cd frontend && npm test` | 0 | pass (54 files, 702 tests) |
| `cd frontend && npm run lint` | 0 | pass (the one warning it noted, in `ChatSurface.tsx`, was fixed afterwards) |
| `cd frontend && npm run build` | 0 | pass. The A2UI code is in lazy chunks (`ChatSurface-*`, `a2ui-theme-*`, `A2uiLabPage-*`), not in `index-*.js`. |
| `cd frontend && npm run e2e` | 0 | pass, as run by qc-e2e. Final tree: 379 passed, 0 failed, 34 skipped, stamped at `45a7f1f82f`. |
| `openspec validate a2ui-chat-agent --strict` | 0 | pass |

## Spec scenario coverage

Every scenario in `specs/a2ui-chat`, `specs/agent-chat` and `specs/agent-providers` maps to a test:
- `backend/tests/test_a2ui_{content,templates,bank,tools,runner,chat,actions}.py`
- `backend/tests/test_isolation_a2ui.py`, `test_agent_providers_api.py`
- `frontend/src/components/agent/{ChatSurface,MessageList}.test.tsx`, `a2ui/labCatalog.test.tsx`
- `frontend/e2e/a2ui-chat.e2e.ts`, `responsive.e2e.ts`

Uncovered scenarios: none.

## Security points (checked)

- No answer number or explanation in surface messages before grading. Checked by unit tests (templates, chat, runner, tools) and by e2e on the network response.
- The grading route needs the app header, filters by user with `SELECT … FOR UPDATE`, and answers 404 for another user's surface. It never calls a model.
- The content schemas forbid extra fields and have no URL or image fields.
- Model Markdown images from outside the app are rendered as text placeholders (chat answers, A2UI text, the Lab).
- The MCP server (claude-code) does not expose `show_interactive`, `make_quiz` or `make_lesson`.

## Notes

- After this verification, small fixes landed: the correct-option ✓ and the right/wrong mark, the phone width, the lint warning, and the dark button CSS. They were covered by:
  - the A2UI backend tests (39), ruff and mypy;
  - frontend tests (702), lint (0 warnings) and build;
  - the final full e2e run above.

  The full backend suite also runs in the commit gate.
- The remaining cosmetic defect (dark Check button colour) is listed in `evidence.md`.
