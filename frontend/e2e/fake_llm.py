"""Fake OpenAI-compatible LLM server for the e2e tests (port 8002, never a real provider).

The requested model name selects the behavior: fake-ok answers, fake-401/404/429/500 fail
with an OpenAI-style error body, fake-slow answers after 5 seconds.
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
                    "message": {"role": "assistant", "content": "OK from fake"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 3, "total_tokens": 4},
        }
    )
