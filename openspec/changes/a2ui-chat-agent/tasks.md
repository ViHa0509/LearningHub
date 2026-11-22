# Tasks

Contract: `design.md` (Decision 7 is the API contract) and the specs in `specs/`. Groups 1-3 are backend and group 4 is frontend; with the contract fixed they can run in parallel. Never run two backend pytest runs at once (they share `learninghub_test`). Backend checks per task: the task's tests, then `ruff check . && ruff format --check .` and `mypy app`.

## 1. Data and content (backend)

- [x] 1.1 Migration `0023_a2ui_surfaces` and the `A2uiSurface` ORM model in `app/db.py` (design 4): user FK and message FK, both `ON DELETE CASCADE`, JSONB `messages`, `answer_key` and `answers`. Verify: `alembic upgrade head` on the dev DB, and `alembic downgrade -1` followed by `upgrade head` work; the existing RLS test covers the new table; `pytest`, `ruff`, `mypy app`.
- [x] 1.2 `app/a2ui/content.py` (design 2): `QuizContent`, `QuizQuestion`, `LessonContent` and `Section` with the limits, with JSON Schemas for the tools. `tests/test_a2ui_content.py` covers each limit (1 option, 7 options, answer out of range, 2 or 11 questions, a check section without a question, a non-check section without a body) and a valid quiz and lesson. Verify: that file, `ruff`, `mypy app`.
- [x] 1.3 `app/a2ui/templates.py` (design 5): `build_quiz` and `build_lesson` produce `createSurface`, `updateComponents` and `updateDataModel` for the v0.9 basic catalog, plus `grade_messages(...)` for the result updates. `tests/test_a2ui_templates.py`:
  - the serialized messages contain no answer number or explanation;
  - component ids are unique and one is `root`;
  - every component type is in the basic catalog list;
  - the Check button's action and context shape;
  - a lesson with a check section;
  - at most 10 questions.

  Verify: that file, `ruff`, `mypy app`.
- [x] 1.4 `app/a2ui/bank.py` (design 3): draw from the area's visible bank, current topic first, count defaulting to 5 with at most 10, the image URL when `image_key` is set, and the placeholder for a null explanation. It reuses the practice access check without duplicating it. `tests/test_a2ui_bank.py` covers each case, plus a bank in an area the user cannot see, which is not used. Verify: that file, `ruff`, `mypy app`.

## 2. Agent wiring (backend)

- [x] 2.1 `agents.py`: the `a2ui` "Interactive tutor" agent with content-only instructions, and the assistant's instructions for `show_interactive` (design 8). Update the agent list test to expect four agents (spec `agent-providers`: List agents). Verify: the agents tests, `ruff`, `mypy app`.
- [x] 2.2 `tools.py`, `loop.py`, `results.py`, `resolve.py` (design 1, 2, 8):
  - `show_interactive` in the assistant's specs, following the area's `allowed` set;
  - `make_quiz` and `make_lesson` handlers that validate with `content.py`;
  - the `a2ui` agent's specs: the read tools plus the one content tool for its kind;
  - `ToolOutcome.surface`, `AgentResult.surfaces`, the copy in `tool_loop`, and `merged()` keeping both halves' surfaces.

  Tests with an injected fake runner:
  - the tool is offered or not offered by area settings;
  - the result to the model has no answers;
  - invalid content is refused with its reason;
  - surfaces survive a fallback handover.

  Verify: the new tests, `ruff`, `mypy app`.
- [x] 2.3 `app/a2ui/runner.py` `InteractiveRunner` (design 1, 3, 4). It follows the bank path or the sub-run with `resolve_chain("a2ui")` and `AgentModel.count_with(parent)` (add this method), `max_steps=6`, and an error when `runs_own_loop`. It adds the `A2uiSurface` row to the request's session. Tests with injected factories scripting the sub-agent:
  - quiz made;
  - practice with a bank makes no model call;
  - practice without a bank generates;
  - lesson with a check section;
  - the provider fails;
  - the steps run out;
  - a text-only end makes no surface;
  - a `claude-code` provider gives an error.

  Verify: the new tests, `ruff`, `mypy app`.
- [x] 2.4 `routes/agent.py` and `routes/chat_sessions.py` (design 4, 7): build the runner, `ChatOut.surfaces`, and set `message_id` in the same commit as the turn. Stored chat detail includes surfaces, with one replay `updateDataModel` per answered question. Tests:
  - a chat answer with a surface;
  - a failed request leaves no surface row;
  - the stored detail replays progress;
  - retry removes the later surfaces;
  - deleting the chat removes them.

  Verify: the new tests, then the full `pytest` (in the background), `ruff`, `mypy app`.
- [x] 2.5 Spec "One request, one count": in shared mode a quiz request takes one daily count and one rate-limit slot, and grading takes none. Also `tests/test_isolation_a2ui.py`: another user's surface is invisible in stored chats and its actions answer 404. Verify: those tests, `ruff`, `mypy app`.

## 3. Grading (backend)

- [x] 3.1 `routes/a2ui.py` (design 6): `POST /api/a2ui/surfaces/{id}/actions` with `SELECT … FOR UPDATE`, first result wins, and bank answers recorded through the practice record helper (move it to `app/practice/` if it is route-private). `tests/test_a2ui_actions.py` covers every scenario of the spec requirements "Grade an answer" and "Bank answers count as practice": right, wrong, answer twice, someone else's surface, unknown action, unknown question, option out of range, missing app header → 403, and a wrong bank answer appearing in the wrong-questions practice. Verify: that file, then the full `pytest` (in the background), `ruff`, `mypy app`.

## 4. Frontend

- [x] 4.1 Markdown image guard (design 10) in `markdownConfig.tsx`. Tests in `MessageList.test.tsx` and `labCatalog.test.tsx` (LabMarkdown): an outside image renders as the placeholder with alt and address and no `img`; `/brand/logo-mark.svg` renders an `img`. Verify: `npm test`, `npm run lint`, `npm run build`.
- [x] 4.2 `api.ts` types and `api.a2uiAction` (design 7). Move the `--a2ui-*` theme mapping to a shared `.a2ui-theme` class used by the Lab root, so the Lab looks the same (design 9). Verify: `npm test` (including the existing A2UI Lab tests), `npm run lint`, `npm run build`.
- [x] 4.3 Lazy `ChatSurface` and `Entry.surfaces` (design 9), from the live answer and from stored chats. `ChatSurface.test.tsx`:
  - it renders a surface from the messages;
  - an action posts the expected body and applies the returned messages;
  - a failed action shows an error under the surface;
  - a surface that fails to process shows its error while the answer text still shows;
  - stored-chat replay shows the answered state.

  Verify: `npm test`, `npm run lint`, and `npm run build` with the A2UI code still out of the main `index-*.js` chunk (grep the built chunks).

## 5. E2E

- [x] 5.1 `frontend/e2e/fake_llm.py` (design 11): triggers for `show_interactive` from "quiz me", "practice" and "interactive lesson", and scripted `make_quiz` and `make_lesson` calls when the system prompt is the `a2ui` agent's, including one question with HTML and an outside Markdown image. Verify: `npm run e2e -- agent-chat.e2e.ts` still passes (the existing chat scripts are unchanged).
- [x] 5.2 qc-e2e: a new `frontend/e2e/a2ui-chat.e2e.ts` from the spec scenarios:
  - quiz me, then a right answer, a wrong answer and answering twice;
  - no answers in the chat response (inspect the network answer);
  - practice with an imported bank;
  - practice without a bank;
  - an interactive lesson with a check;
  - reopening the chat from history keeps the progress;
  - an outside image in an answer and in a surface makes no request;
  - dark theme;
  - the Interactive tutor listed in Settings > Agents.

  Add light and dark screenshots, and a phone screenshot in `responsive.e2e.ts`. Verify: the touched e2e files pass locally; the full suite runs in the background (and in CI).
- [x] 5.3 qc-ui: inspect the new screenshots in light and dark, on desktop and phone. Verify: no defect left, or each one listed in `evidence.md`.

## 6. Evals and verification

- [x] 6.1 A live eval case in `backend/evals/test_golden.py`: "quiz me on Redis eviction" calls `show_interactive` with kind `quiz`, and the `a2ui` agent's content passes `QuizContent` validation. It is marked `live` and skipped without a key. Verify: `pytest evals -m live --collect-only` lists it, and the normal `pytest` does not run it.
- [x] 6.2 README: one line under Features. Every check in CLAUDE.md passes and `openspec validate a2ui-chat-agent --strict` passes. Verify: the verifier report is in `verifier-report.md`.

## Workflow follow-up

- Commit and push to `main` when everything is okay (CLAUDE.md, Agent team), then archive the change.
- Archive `a2ui-lab-playground` (done and deployed) before or with this one, since this change reuses its renderer.
- Next change, decided by the owner on 2026-11-22: `a2ui-lesson-blocks`. A Learning Hub A2UI catalog of note-style lesson blocks (hero, callouts, step timeline, comparison table, key terms, code with a caption, inline checks), modelled on the owner's note 937710f5-3a5d-43af-9642-6dd706fc3320 on the hosted copy. The `lesson` kind then switches to it. The agent still only picks and fills blocks; the server validates them and the frontend renders.
