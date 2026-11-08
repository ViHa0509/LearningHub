"""Fake OpenAI-compatible LLM server for the e2e tests (port 8002, never a real provider).

The requested model name selects the behavior: fake-ok answers, fake-401/404/429/500 fail
with an OpenAI-style error body, fake-slow answers after 5 seconds.

fake-ok answers "OK from fake", except when the last user message contains a trigger:
[[markdown]] answers with a Markdown table, a code block and an HTML tag; [[echo]] answers
with one line per fact about what the model received (system prompt and last user message),
so the UI tests can observe effort lines and attachment wrapping without a real provider.

It also fakes the reference source (GitHub's tree API and raw files of the roadmap repository)
under /roadmap-api and /roadmap-raw, so the resource sync never reaches GitHub or roadmap.sh.
The tree lists one synthetic file for every slug of roadmaps/sources/frontend.yaml (and one extra
file per roadmap for "<roadmap>/*"); every file holds synthetic links on example.test only.
POST /roadmap-control {"fail": true} makes the tree listing answer 500 until switched back.
"""

import asyncio
import time
from pathlib import Path

import yaml
from fastapi import FastAPI
from fastapi.responses import JSONResponse, PlainTextResponse

app = FastAPI()

MAPPING = Path(__file__).resolve().parents[2] / "roadmaps" / "sources" / "frontend.yaml"
TREE_DELAY_S = 1.5  # keeps "Syncing references…" on screen long enough to be seen
roadmap_state = {"fail": False}


def _roadmap_files() -> dict[str, str]:
    """Repository path -> synthetic node file, for every mapped slug."""
    mapping = yaml.safe_load(MAPPING.read_text(encoding="utf-8"))
    files: dict[str, str] = {}
    for refs in mapping["nodes"].values():
        for ref in refs:
            roadmap, slug = ref.split("/", 1)
            if slug == "*":
                slug = "e2e-extra-topic"
            path = f"roadmaps/{roadmap}/content/{slug}@e2e{roadmap[:3]}.md"
            lines = [
                f"# Synthetic {roadmap} {slug}",
                "",
                "Description text that the sync must ignore.",
                "",
                f"- [@article@Synthetic article {roadmap} {slug}](https://example.test/{roadmap}-{slug}-article)",
                f"- [@official@Synthetic official {roadmap} {slug}](https://example.test/{roadmap}-{slug}-official)",
            ]
            if (roadmap, slug) == ("frontend", "html"):
                lines.append("- [@video@Synthetic video frontend html](https://example.test/frontend-html-video)")
            files[path] = "\n".join(lines) + "\n"
    return files


@app.post("/roadmap-control")
def roadmap_control(payload: dict) -> dict:
    roadmap_state["fail"] = bool(payload.get("fail"))
    return roadmap_state


@app.get("/roadmap-api/repos/kamranahmedse/developer-roadmap/git/trees/{commit}")
async def roadmap_tree(commit: str) -> JSONResponse:
    await asyncio.sleep(TREE_DELAY_S)
    if roadmap_state["fail"]:
        return JSONResponse({"message": "fake source failure"}, status_code=500)
    tree = [{"path": p, "type": "blob"} for p in sorted(_roadmap_files())]
    return JSONResponse({"sha": commit, "truncated": False, "tree": tree})


@app.get("/roadmap-raw/kamranahmedse/developer-roadmap/{commit}/{path:path}")
def roadmap_raw(commit: str, path: str) -> PlainTextResponse:
    text = _roadmap_files().get(path)
    if text is None:
        return PlainTextResponse("404: Not Found", status_code=404)
    return PlainTextResponse(text)

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
