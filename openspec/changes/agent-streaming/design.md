# Design: agent-streaming

## 1. Wire format
`POST /api/agent/chat` with `Accept: application/x-ndjson` (same body, session and `X-LearningHub: 1`); without that header the route answers one `ChatOut` as before, so existing callers are unchanged. Every check `/chat` makes before the model runs (agent, stored chat, provider, rate limit, daily count, run id) answers the same HTTP error, before any byte of the stream. After that the answer is `200`, `Content-Type: application/x-ndjson`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, one JSON object per line:

- `{"type": "text", "text": "<delta>"}` - answer text as the model writes it.
- `{"type": "step", "step": {"tool", "input", "summary"}}` - a tool step that ended. Text written before a tool call is not the answer: the client drops the text shown so far when a step arrives.
- `{"type": "done", "answer": <ChatOut>}` - last line on success; `answer.reply` is the final text (sources and the cut note added) and replaces the streamed text.
- `{"type": "error", "status": <int>, "detail": "<text>"}` - last line on failure (502 provider error, 404 chat deleted while working, 500 otherwise with "the agent request failed"); nothing is stored, as with `/chat`.

## 2. Backend
- `tool_loop` / `run_agent` take `on_text` and `on_step` (both optional). `on_text` is passed to `complete()` only when set, so models and test doubles without it are unchanged. `AgentModel.complete` passes it on to the adapter.
- `AnthropicChat.complete(on_text=...)` uses `client.messages.stream(...)`: `text_stream` feeds `on_text`, `get_final_message()` gives the `Turn` as before (pause turns too).
- `OpenAICompatibleChat.complete(on_text=...)` sends `stream=True` and builds the same response shape from the chunks (content deltas, tool call deltas by index, finish reason), then `from_openai` as before.
- The route runs `_answer` in a worker thread (`asyncio.to_thread`) with callbacks that put events on an asyncio queue; the async body yields them as lines. The worker uses the request's DB session, so the body waits for the worker in a shielded scope even when the client disconnects (the run then ends and is stored, as with `/chat`). `end_run` stays in the worker's `finally`.
- shortcut: when the primary provider fails after it streamed some text and the fallback answers, the client shows both texts until `done` replaces them.

## 3. Frontend
- `api.chatStream(body, onEvent)`: `fetch` with `X-LearningHub: 1` and `Accept: application/x-ndjson`; a JSON answer (a proxy or mock that does not stream) is taken as the final answer, a non-2xx answer throws `ApiError` exactly as `request()` does; the body is read line by line; an `error` event throws `ApiError(status, detail)`; returns the `done` answer.
- `useAgentChat.send` uses it. While running, a live assistant entry (`streaming: true`) holds the text so far and the steps; a step clears its text. On `done` it becomes the final entry (the same fields as today). On error the live entry is removed and the question shows the error, as today.
- `MessageList`: "Thinking…" shows only while the live entry has no text yet; the live entry hides Copy/Retry and the provider line until it is done.
