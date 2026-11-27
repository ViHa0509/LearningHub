# Proposal: stream the agent's answer

## Why
The Agent panel shows "Thinking…" until the whole run ends (every tool call and the full answer), then the answer appears at once. A run with a few tool calls feels slow even when the model starts writing after a second or two.

## What changes
- `POST /api/agent/chat` called with `Accept: application/x-ndjson` answers a stream of events: answer text as the model writes it, each tool step when it ends, and at the end the same answer object `/chat` returns (or an error).
- The Anthropic and OpenAI-compatible adapters stream from the provider when asked to. Claude Code runs its own loop and keeps sending its answer at the end.
- The chat panel uses the stream: the answer grows as it is written, and "Used N tools" grows while the tools run.
- Without that header `/api/agent/chat` answers as today.

## Not in this change
- Streaming the Claude Code provider or the nested tutor (A2UI) run.
- Stopping the run when the browser disconnects (a run already goes on to the end and is stored, as today).
