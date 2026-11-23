## Context

- `POST /api/agent/chat` is one blocking request (plain `def` route, no streaming). It resolves the provider, counts the rate and daily limits, runs `run_agent` and stores the turn with `store_turn` after the answer. A failed run stores nothing.
- `tool_loop` (`app/agent/loop.py`) calls the model and runs tools one by one. Writing tools (`write_lesson`, `save_learned_note`, the A2UI tutor) commit on their own, so their effect stays even if the request later fails.
- The Claude Code provider runs its own loop in a child process; `ProcessRunner.run(on_line=...)` already kills the whole process tree when `on_line` returns False (`stopped`).
- The assistant can start a nested tutor run (`ChatInteractiveRunner`, `app/a2ui/runner.py`) inside a tool call.
- The hosted app runs on Vercel functions behind a Worker: the stop request can land on another instance than the run, and a client disconnect is not seen by a sync route. In-process state is not enough.

## Goals / Non-Goals

**Goals:** stop within one model call or one tool call; no partial tool effect; history that matches side effects; works on Vercel and locally.

**Non-Goals:** cancelling a model HTTP call already in flight (its tokens are spent; the result is dropped), approval before tool calls, streaming.

## Decisions

1. **Client run id.** The client makes a UUID per send and passes it as `run_id` in `ChatIn` (optional, so old clients and tests keep working). The client knows it before the answer, so Stop works while the request is pending. Alternative: server-issued id in a first response; needs streaming or two requests, rejected.

2. **Stop flag in the database.** New table `agent_runs (id uuid pk, user_id fk, started_at, stop_requested_at null)`, migration 0024, RLS like every public table. The chat route inserts the row (own short transaction, committed at once) before the loop starts and deletes it when the turn is stored or fails. `POST /api/agent/runs/{run_id}/stop` (session + `X-LearningHub` header) sets `stop_requested_at` where `id` and `user_id` match and answers 204 always; an unknown run, an ended run and another user's run are not told apart. A `run_id` already in use answers 409. Alternative: in-memory dict in `app.state`, rejected because of multiple Vercel instances; `request.is_disconnected()` rejected because sync routes and the Worker do not pass it on reliably.
   - Rows left by a crashed request: the route deletes rows of that user older than 1 hour when it inserts a new one. No cron needed.

3. **Check points.** A `StopSignal` callable (`() -> bool`, reads the row with its own short-lived connection so it does not touch the request session's transaction) is passed into `run_agent` → `tool_loop` and checked before each model call and before each tool call. Reads are cheap (one primary-key select per step). On a stop, the loop sets `result.stopped = True` and `result.reply = "Stopped by you."` and returns the steps so far.
   - Claude Code: `on_line` also returns False when the signal is set, checked at most once per second (time-based, so a chatty stream does not hammer the database), then the existing kill path runs.
   - Nested tutor: `ChatInteractiveRunner` gets the same signal and passes it to its own `tool_loop`; a stopped tutor stores no surface and returns a failed result, so the outer loop then sees the stop at its next check.

4. **Stored like an answer.** A stopped run goes through the normal `store_turn` path with the existing `stopped=True` (already in `ChatOut` and on `chat_messages`) and the reply "Stopped by you.". The panel shows a Stopped mark for every stopped answer (a step-cap stop is a stopped answer too; its reply says why). No new column. Rate and daily counts were taken before the run and are not given back.

5. **Client side.** `useAgentChat.stop()` posts the stop and keeps waiting for the chat response, which arrives with `stopped: true` within a step. It does not abort the fetch: aborting would drop the stored ids and leave the panel out of step with history. If the chat request then fails, the normal error row shows. The Stop button is disabled after one press until the answer comes.

## Risks / Trade-offs

- [A model call already in flight cannot be cut, so a stop can take as long as one model call (up to the provider timeout)] → the button shows "Stopping…" after the press; a later change with streaming can cut sooner.
- [A tool started before the stop still writes (e.g. a lesson)] → intended (no half writes); the trace lists it, and the lesson keeps its history as today.
- [An extra select per step] → one primary-key read on a tiny table; negligible next to a model call.
- [Rows left by a killed function] → cleaned on the user's next run (Decision 2).

## Migration Plan

Migration 0024 adds the `agent_runs` table, with RLS. No existing data changes. Rollback: drop the table.
