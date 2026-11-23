## Why

Once a chat question is sent, the user cannot stop the agent. A slow or wrong run (a wrong agent, a misread question, a long high-effort run, a Claude Code run) holds the panel busy until it ends or times out, keeps spending provider tokens and the shared daily count, and can still write a lesson or save a note the user no longer wants. A person must be able to stop the agent while it works (human in the loop).

## What Changes

- While the agent works, the composer's Send button becomes **Stop**. Pressing it stops the answer.
- The server stops the run at its next safe point: before the next model call and before each tool call. A tool that already started finishes (no half-written lesson). A Claude Code run is ended by killing its process tree.
- The stopped turn is stored like an answer, with the question, the tool steps done so far and the reply "Stopped by you." with a "Stopped" mark. History then matches what the agent really did (a lesson it already wrote stays written and is listed in the trace).
- Retry on a stopped answer sends the question again. Typing a new message continues the chat as usual.
- A stop of a run that already ended, or of another user's run, changes nothing.
- Out of scope (later changes): approval before each writing tool call (approve or deny `write_lesson`, `save_learned_note`), steering a running answer with a new message, streaming partial text, stopping the lesson import or news jobs.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `agent-chat`: a new requirement "The user can stop a running answer", and the Chat panel requirement's composer shows Stop while the agent works.

## Impact

- Backend: a run id on `POST /api/agent/chat`, a new route `POST /api/agent/runs/{run_id}/stop`, a stop check in the tool loop, in the Claude Code runner and in the nested A2UI tutor run; a new table `agent_runs` (migration 0024, RLS on; no change to existing tables) because the hosted app runs on Vercel functions, where the stop request can reach another instance than the run.
- Frontend: `useAgentChat` sends a run id and gains `stop()`; `Composer` shows Stop while busy; `MessageList` shows a Stopped mark on every stopped answer (the existing `stopped` flag, today not shown).
- Tests: pytest for the route, the loop, the runner and user isolation; Vitest for the composer and the hook; e2e with the fake LLM (a slow trigger) in `agent-chat.e2e.ts`.
- No new dependency.
