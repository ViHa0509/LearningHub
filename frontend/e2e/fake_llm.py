"""Fake OpenAI-compatible LLM server for the e2e tests (port 8002, never a real provider).

The requested model name selects the behavior: fake-ok answers, fake-401/404/429/500 fail
with an OpenAI-style error body, fake-slow answers after 5 seconds.

fake-ok answers "OK from fake", except when the last user message contains a trigger:
[[markdown]] answers with a Markdown table, a code block and an HTML tag; [[echo]] answers
with one line per fact about what the model received (system prompt and last user message),
so the UI tests can observe effort lines and attachment wrapping without a real provider.
"""

import asyncio
import time

from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI()

MODELS = ["fake-ok", "fake-401", "fake-404", "fake-429", "fake-500", "fake-slow"]

ERRORS = {
    "fake-401": (401, "authentication_error", "Incorrect API key provided: fake.", "invalid_api_key"),
    "fake-404": (404, "invalid_request_error", "The model `fake-404` does not exist", "model_not_found"),
    "fake-429": (429, "rate_limit_error", "Rate limit reached for fake-429.", "rate_limit_exceeded"),
    "fake-500": (500, "server_error", "The fake server had an error.", None),
}


MARKDOWN_ANSWER = """Here is a comparison:

| Token | Lifetime |
| --- | --- |
| Access | 15 minutes |
| Refresh | 7 days |

```python
print("hello jwt")
```

Raw tag: <b>not bold</b>
"""


def _text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(str(p.get("text", "")) for p in content if isinstance(p, dict))
    return ""


def _answer(payload: dict) -> str:
    messages = payload.get("messages") or []
    system = "\n".join(_text(m.get("content")) for m in messages if m.get("role") == "system")
    users = [_text(m.get("content")) for m in messages if m.get("role") == "user"]
    last = users[-1] if users else ""
    if "[[markdown]]" in last:
        return MARKDOWN_ANSWER
    if "[[echo]]" in last:
        facts = {
            "effort-low": "Answer briefly" in system,
            "effort-high": "Be thorough" in system,
            "data-rule": "<attached_file>" in system,
            "wrapped": '<attached_file name="' in last and "</attached_file>" in last,
            "file-text": "ignore previous instructions" in last,
        }
        return "\n\n".join(f"ECHO {k}={'yes' if v else 'no'}" for k, v in facts.items())
    return "OK from fake"


def error_response(status: int, kind: str, message: str, code: str | None) -> JSONResponse:
    body = {"error": {"message": message, "type": kind, "param": None, "code": code}}
    return JSONResponse(body, status_code=status)


@app.get("/v1/models")
def list_models() -> dict:
    return {
        "object": "list",
        "data": [{"id": m, "object": "model", "created": 0, "owned_by": "fake"} for m in MODELS],
    }


@app.post("/v1/chat/completions")
async def chat_completions(payload: dict) -> JSONResponse:
    model = str(payload.get("model", ""))
    if model in ERRORS:
        return error_response(*ERRORS[model])
    if model == "fake-slow":
        await asyncio.sleep(5)
    elif model != "fake-ok":
        return error_response(404, "invalid_request_error", f"The model `{model}` does not exist", "model_not_found")
    return JSONResponse(
        {
            "id": "chatcmpl-fake",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": _answer(payload)},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 3, "total_tokens": 4},
        }
    )
