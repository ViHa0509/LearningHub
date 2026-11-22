# Design

## Context

See proposal.md (Why) and the specs in this change. The code this design builds on:

- **Agents** are `AgentDef`s in `backend/app/agent/agents.py` (`assistant`, `lesson-writer`, `outline`). Settings > Agents lists `AGENTS`, so a new entry gets a provider card automatically.
- **Tools** are in `backend/app/agent/tools.py`.
  - `AgentTools` has one handler per tool and `specs()` picks the specs per agent (`SPECS`, `ASSISTANT_SPECS`, `OUTLINE_SPECS`), filtered by the area's `allowed` set.
  - A handler returns a `ToolOutcome(result, summary, changed_lesson, proposal, changed_note)`.
  - Optional dependencies are injected into the constructor, for example `kh_search`.
- **The loop**: `tool_loop` in `app/agent/loop.py` copies `outcome.proposal` into `AgentResult.proposed_topics`, and `ChatOut` carries it. The outline agent's proposal is the model to follow for "a tool produces something the panel shows".
- **Providers**: `resolve_chain(session, user_id, box, factory, agent_id)` in `app/agent/resolve.py` builds an `AgentModel` with its fallback chain. In shared mode `AgentModel` refuses to build a model until `count()` has taken the daily count. `merged(before, after)` combines results when a fallback takes over. `runs_own_loop(model)` is true for the `claude-code` type.
- **Chat route**: `app/routes/agent.py` `chat()` resolves the agent's chain, takes a rate-limit slot, counts, runs `run_agent` with `AgentTools(...)`, and stores the turn as two `chat_messages` rows.
- **Practice**: `question_banks` (per `learning_areas`) and `questions` (`text`, `options` JSONB, `answer` 1-based, `explanation`, `topic_slug`, `image_key`). `question_answers` records a user's last answer per question (`last_correct`, `times_wrong`, `last_choice`). `app/routes/practice.py` has `_record(...)` and serves pictures at `/api/questions/{id}/image`, which is same-origin and so allowed by the media guard.
- **A2UI on the frontend**, from change `a2ui-lab-playground`, all in `frontend/src/components/a2ui/`:
  - `createLabCatalog()` (basic catalog plus guarded media);
  - `LabMarkdown`;
  - `isAllowedMediaUrl`;
  - the theme bridge `a2ui-lab.css` (scoped to `.a2ui-lab`);
  - the `useA2uiLab` pattern (a processor, surfaces, and an action handler).

  The renderer is `@a2ui/react` 0.15.0, protocol v0.9. In the basic catalog, `ChoicePicker.value` is a string list and its options are `{label, value}`.
- **Migrations** are in `backend/alembic/versions/`; the latest is `0022_user_timezone`. `alembic/env.py` turns on RLS for every public table.
- **Fake LLM**: the e2e fake server `frontend/e2e/fake_llm.py` scripts tool calls from trigger words in the request (`_outline_call`, `_learn`, `_kh`).

## Goals / Non-Goals

**Goals:**
- One server-side A2UI pipeline: content (from the bank or the model) → validated schema → template → v0.9 messages, with the answer key stored separately.
- Grading with no model call, and correct answers never in the browser early.
- A contract fixed up front (below), so the backend and frontend work in parallel.

**Non-Goals:**
- The `claude-code` provider type for `show_interactive` or for the `a2ui` agent. The MCP server runs in another process with no provider factory, so nesting a run there is out of scope.
- Streaming; model-written feedback per answer; surfaces in the backup.
- Using the A2UI `List` template binding (see Decision 5).

## Decisions

### 1. The `a2ui` agent is a sub-run inside the assistant's tool call
`show_interactive` is an assistant tool. Its handler calls an injected `InteractiveRunner` (like `kh_search`). The route builds that runner with the session, user, catalog, page, box and factory. For `quiz`, `lesson`, or `practice` without a bank, the runner:
1. resolves the `a2ui` chain with `resolve_chain(..., "a2ui")`;
2. marks it as counted by the parent request without taking a daily count (a small method on `AgentModel`, for example `count_with(parent)`; spec: one request, one count);
3. returns an error when `runs_own_loop(model)`;
4. runs `tool_loop` with `AgentTools(agent_id="a2ui")`, whose `specs()` offer `search_notes`, `read_note`, `read_lesson`, `list_roadmap` and exactly one content tool (`make_quiz` or `make_lesson`), with `max_steps=6`.

The system prompt is the `a2ui` agent's instructions plus the page description (`system_prompt`) and the requested kind, topic and count.
*Alternative:* the assistant model writes the quiz itself. Rejected: the owner asked for a separate A2UI agent with its own provider, which also lets a cheaper model do content.

### 2. Content schemas, validated in code (`app/a2ui/content.py`)
Pydantic models, which are also the tools' JSON Schemas:
- `QuizContent{title (≤120), questions: 3-10 × QuizQuestion}`
- `QuizQuestion{text (≤600), options: 2-6 × str (≤200), answer: int 1-based in range, explanation (≤800)}`
- `LessonContent{title (≤120), sections: 3-8 × Section}`
- `Section{kind: concept|example|tip|check, heading (≤120), body Markdown (≤2000) for non-check sections, question: QuizQuestion when kind=check}`

There are no URL or image fields. A validation failure returns `_error(reason)` to the agent, so it can fix the content. A valid call ends the sub-run: the handler stores the content on the runner and the loop stops at the agent's next text reply.

### 3. Practice from the bank (`app/a2ui/bank.py`)
Find the area of the page (`area_of_page`) and the first bank the user can see there, using the same visibility as `practice.py` (`_bank_of`'s rules; reuse that helper and don't duplicate the access check). Draw `count` (default 5, max 10) at random from questions whose `topic_slug` matches the node's slug, then fill up from the rest of the bank. Build the same `QuizContent` shape internally, with `bank_question_id` and an image URL `/api/questions/{id}/image` when `image_key` is set. When the explanation is null, use "No explanation in the bank."

### 4. Storage: table `a2ui_surfaces` (migration `0023_a2ui_surfaces`)
Columns:
- `id` uuid pk;
- `user_id` FK users ON DELETE CASCADE, indexed;
- `message_id` FK chat_messages ON DELETE CASCADE, nullable, indexed;
- `kind` text (`quiz`, `practice` or `lesson`);
- `title` text;
- `messages` JSONB (the v0.9 messages as first sent);
- `answer_key` JSONB `{question_id: {answer, explanation, options, bank_question_id|null}}`;
- `answers` JSONB `{question_id: {choice, correct}}` default `{}`;
- `created_at`.

The runner adds the row to the request's DB session. The chat route sets `message_id` to the stored assistant message in the same transaction that stores the turn. If the request fails before that, the transaction does not commit and the row goes with it. Verify how `chat()` commits and keep surfaces in that one commit. Retry deletes the later messages, so the FK cascade removes their surfaces. Isolation: every query filters by `user_id` (CLAUDE.md, Users), and another user's id answers 404.

### 5. Templates: explicit components, absolute paths (`app/a2ui/templates.py`)
`build_quiz(surface_id, content) -> list[message]` and `build_lesson(...)`. Each produces `createSurface` (catalogId = the v0.9 basic catalog id), then `updateComponents`, then `updateDataModel` at `/`.

Components are explicit per question (`q1-card`, `q1-text`, `q1-image`, `q1-choice`, `q1-check`, `q1-feedback`; at most 10 questions), not a `List` template. The ids are stable and grading responses can update fixed paths. This is simpler to test.

The data model:
```
{ "title": str,
  "score": {"text": "0 / 5 answered, 0 correct"},
  "questions": { "q1": { "text": str, "options": [{"label": str, "value": "1"}, ...],
                          "choice": [], "status": "open", "feedback": "" , "image": str? } } }
```
- `ChoicePicker`: `value` bound to `/questions/q1/choice` (a string list), with the options as literals.
- Check `Button`: action `check_answer` with context `{"question": "q1", "choice": {"path": "/questions/q1/choice"}}`.
- Feedback `Text` bound to `/questions/q1/feedback`. Score `Text` bound to `/score/text`.

Lesson sections are Cards: a kind label Text, a heading Text and a body Text. A `check` section embeds the same question components. Text values are literals or data paths; Markdown goes in Text. **No answer or explanation is put anywhere in these messages** (spec: Surfaces carry no answers). A unit test asserts that over the serialized JSON.

### 6. Grading route (`app/routes/a2ui.py`)
`POST /api/a2ui/surfaces/{surface_id}/actions`, session required, `require_app_header`.
- **Body:** `{"version": "v0.9", "action": {"name", "surfaceId", "sourceComponentId", "timestamp", "context": {"question": str, "choice": [str] | str}}}`, with size-capped fields.
- **Validation:**
  - load the surface with `SELECT … FOR UPDATE` filtered by `user_id`; missing → 404;
  - `name != "check_answer"`, an unknown question, or a choice that is not exactly one option value in range → 400.
- **Already answered:** return the stored result's messages.
- **Otherwise:**
  - store `{choice, correct}` in `answers`;
  - for a bank question, call the practice `_record(...)` (move it to `app/practice/` if it is route-private);
  - commit;
  - reply `200 {"messages": [updateDataModel ...]}` setting `/questions/qN/status` (`correct` or `wrong`), `/questions/qN/feedback` ("Correct. …" or "Not quite. The answer is "<option>". …" plus the explanation) and `/score/text`.

No rate-limit slot and no model call.

### 7. API contract
- `ChatOut.surfaces: list[SurfaceOut] = []`, with `SurfaceOut = {id: uuid, kind: "quiz"|"practice"|"lesson", title: str, messages: list[dict]}`.
- Stored chat detail (`GET /api/agent/sessions/{id}`): each assistant message gets `surfaces: list[SurfaceOut]`. Its `messages` are the stored messages followed by one `updateDataModel` per answered question, so the client replays the progress.
- Action route as in Decision 6. Errors use the app's usual `{"detail": str}`.
- Frontend types are in `api.ts`: `SurfaceOut`, `ChatReply.surfaces?`, `StoredChatMessage.surfaces?`, and `api.a2uiAction(surfaceId, action)`, which sends the app header like other mutating calls.

### 8. Result plumbing
- `ToolOutcome.surface: dict | None` and `AgentResult.surfaces: list[dict]` (appended in `tool_loop`).
- `merged()` keeps the surfaces from both halves of a fallback handover.
- The tool's `result` to the assistant model is `{"surface": {"kind", "title", "questions": n}}` and the summary is "Made an interactive quiz: <title> (5 questions)".
- Assistant instructions: when the user asks to be quizzed, to practise, or for an interactive or creative lesson, call `show_interactive` with the topic of the page or the message. After it succeeds, reply with one or two sentences that introduce it, and never repeat the questions or answers in text.

### 9. Chat panel rendering (frontend)
- `Entry.surfaces?: SurfaceOut[]` is filled from the live answer and from stored chats (`toEntries`).
- A lazily loaded `ChatSurface` (`React.lazy`, so the A2UI chunk loads only when an answer has a surface):
  - one `MessageProcessor<ReactCatalogComponent>([createLabCatalog()], onAction)` per surface;
  - `processMessages(surface.messages)` on mount;
  - `onAction` posts to `api.a2uiAction` and processes the returned messages;
  - an error is shown under the surface;
  - it renders `A2uiSurface` inside `MarkdownComponentContext.Provider value={LabMarkdown}`.
- The theme bridge: move the `--a2ui-*` mapping in `a2ui-lab.css` to a shared `.a2ui-theme` class used by both the Lab root and `ChatSurface`, without changing the Lab's look.
- Each surface's id in the browser is `a2ui-<uuid>` (unique per page, matching `createSurface`).

### 10. Markdown image guard
`MODEL_MARKDOWN` in `frontend/src/components/markdownConfig.tsx` gets an `img` renderer:
- when `isAllowedMediaUrl(src, 'image')` passes, render an `img` with `alt`;
- otherwise render `<span class="md-blocked-image">` with the alt text and the address as text.

This one change covers chat answers, A2UI Text Markdown in the chat, and the Lab.

### 11. E2E fake model
`fake_llm.py` adds triggers, following the existing pattern:
- a user message containing "quiz me", "practice" or "interactive lesson" → a `show_interactive` call;
- a request whose system prompt is the `a2ui` agent's → a `make_quiz` or `make_lesson` call with fixed content (including one question whose text holds HTML and an outside Markdown image, for the untrusted-text scenario), then a short text reply.

The practice-with-bank scenario imports a small bank with the same helper `practice-exams.e2e.ts` uses.

## Risks / Trade-offs

- [A sub-run doubles model calls for one request] → it takes one count per request (spec), the step budget is 6, and the content tool ends it. Practice from a bank calls no model.
- [The model sends content that is valid but bad (a wrong "correct" option)] → this can't be fully prevented. The explanation is shown with the result, so the user can judge. A live eval case checks that a known topic gets a sensible quiz (task 6.1).
- [Answer keys in the DB are readable by the admin] → acceptable for a personal learning app. They are not secrets and live under the same RLS as the rest.
- [Two quick clicks grade twice] → `SELECT … FOR UPDATE`, plus first-result-wins (spec: Answer twice).
- [The chat panel bundle grows] → `ChatSurface` is lazy. The build check confirms the A2UI code stays out of the main chunk.
- [The A2UI renderer's TextField label issue] → not used by these templates (ChoicePicker and Button only).
- [`count_with(parent)` touches the shared-mode logic] → it is covered by the shared-mode test in task 2.5, and it is the only way to keep "one request, one count".

## Migration Plan

`0023_a2ui_surfaces` only adds a table; no existing data changes. Rollback with `alembic downgrade -1`, which drops the table and so loses only stored surfaces. Deploy with the normal push to `main`. Vercel runs the migration as the existing deploy does.
