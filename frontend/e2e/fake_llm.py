"""Fake OpenAI-compatible LLM server for the e2e tests (port 8002, never a real provider).

The requested model name selects the behavior: fake-ok answers, fake-401/404/429/500 fail
with an OpenAI-style error body, fake-slow answers after 5 seconds.

fake-ok answers "OK from fake", except when the last user message contains a trigger:
[[markdown]] answers with a Markdown table, a code block and an HTML tag; [[history]] answers
with the number of user messages received and the first one; [[learn:<title>]] makes the assistant call save_learned_note and then report
"LEARN saved <title>" or "LEARN refused <title>" ([[learn:<title>|<category>]] also passes a category);
the note sorter (system prompt starts "You sort notes into groups") answers JSON groups by a keyword in each
note title, case-insensitive: "kube" -> Kubernetes, "career" -> Career, "sql" -> Databases, any other
title is left out; [[echo-system]] <marker> answers
"SYSTEM has=yes|no" by whether the system prompt holds the marker, [[echo-tools]] answers "TOOLS a,b,c"
with the tool names offered to the model; [[echo]] answers
with one line per fact about what the model received (system prompt and last user message),
so the UI tests can observe effort lines and attachment wrapping without a real provider.
[[kh:<query>]] or [[kh:<query>|<project>]] makes the assistant call kh_search (when it is offered) and
then answer "KH ok project=<id> truncated=<bool> <text>" or "KH error <message>" from the tool result,
with "<" and ">" shown as "[" and "]" and line breaks as " / ".

It also fakes the Knowledge Hub (design 9 of kh-connector): an identity service under /kh-idp
(device grant, token, revoke) and the KH API under /kh-api (auth/me, the search flow), driven by
POST /kh-control (see KH_DEFAULTS); GET /kh-control shows what the fake saw. Tokens are made-up strings.

When the request offers the tool propose_topics (only the outline agent gets it) and the
conversation has no tool result yet, the model answers with one propose_topics tool call for the
area named in the last user message ("(<slug>)", as "Draft topics with agent" sends it); once the
tool result is in, it answers "Proposed topics for review." as plain text.

It also fakes the reference source (GitHub's tree API and raw files of the roadmap repository)
under /roadmap-api and /roadmap-raw, so the resource sync never reaches GitHub or roadmap.sh.
The tree lists one synthetic file for every slug of roadmaps/sources/frontend.yaml (and one extra
file per roadmap for "<roadmap>/*"); every file holds synthetic links on example.test only.
POST /roadmap-control {"fail": true} makes the tree listing answer 500 until switched back.
"""

import asyncio
import base64
import hashlib
import json
import re
import secrets
import time
from pathlib import Path

import yaml
from urllib.parse import parse_qs, urlencode

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse, StreamingResponse

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


# --- fake GitHub OAuth (owner-auth e2e) --------------------------------------------------------
# Approves at once and redirects back with a code; the token endpoint checks PKCE like GitHub.
# POST /oauth-control {"email": ...} sets the verified primary email the next sign-in reports.
OWNER_EMAIL = "owner@example.test"
github_state: dict = {"email": OWNER_EMAIL, "user_id": 4242}
github_codes: dict[str, str] = {}  # code -> PKCE challenge


@app.post("/oauth-control")
def oauth_control(payload: dict) -> dict:
    github_state["email"] = str(payload.get("email") or OWNER_EMAIL)
    github_state["user_id"] = int(payload.get("user_id") or 4242)
    return github_state


@app.get("/oauth/github/authorize")
def github_authorize(redirect_uri: str, state: str, code_challenge: str = "") -> RedirectResponse:
    code = secrets.token_urlsafe(16)
    github_codes[code] = code_challenge
    return RedirectResponse(f"{redirect_uri}?{urlencode({'code': code, 'state': state})}", status_code=302)


@app.post("/oauth/github/token")
async def github_token(request: Request) -> JSONResponse:
    form = parse_qs((await request.body()).decode("ascii"))
    code = form.get("code", [""])[0]
    verifier = form.get("code_verifier", [""])[0]
    challenge = github_codes.pop(code, None)
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    if challenge is None or challenge != expected:
        return JSONResponse({"error": "bad_verification_code"}, status_code=400)
    return JSONResponse({"access_token": "fake-github-token", "token_type": "bearer"})


@app.get("/github-api/user")
def github_user() -> dict:
    return {"id": github_state["user_id"], "login": "e2e-owner", "name": "E2E Owner"}


@app.get("/github-api/user/emails")
def github_emails() -> list:
    return [{"email": github_state["email"], "primary": True, "verified": True}]


@app.post("/roadmap-control")
def roadmap_control(payload: dict) -> dict:
    roadmap_state["fail"] = bool(payload.get("fail"))
    return roadmap_state


# --- fake roadmap.sh explorer (roadmap-explorer e2e): one synthetic roadmap ----------------------
# The API answer under /roadmapsh-api, its content files in the tree (ref "master" only) and the raw
# files; GET /github-api/rate_limit accepts one made-up token. Synthetic text only.
RSH_SLUG = "e2e-roadmap"
RSH_TOKEN = "e2eSyntheticRoadmapTokenWXYZ"  # matches ^[A-Za-z0-9_]{20,255}$, not a real token shape
RSH_NODES = [
    {"id": "e2eSub1", "type": "subtopic", "position": {"x": 10, "y": 300}, "data": {"label": "Synthetic Subtopic"}},
    {"id": "e2eLabel1", "type": "label", "position": {"x": 0, "y": 50}, "data": {"label": "Layout only label"}},
    {"id": "e2eTopic1", "type": "topic", "position": {"x": 0, "y": 100}, "data": {"label": "Synthetic Topic"}},
]
RSH_FILES = {
    f"roadmaps/{RSH_SLUG}/content/synthetic-topic@e2eTopic1.md": (
        "# Synthetic Topic\n\nSynthetic description of the topic.\n\n"
        "- [@article@Synthetic reading](https://example.test/e2e-roadmap-topic)\n"
    ),
    f"roadmaps/{RSH_SLUG}/content/synthetic-subtopic@e2eSub1.md": "# Synthetic Subtopic\n\nSynthetic subtopic text.\n",
}


@app.get("/roadmapsh-api/v1-official-roadmap/{slug}")
def roadmapsh_roadmap(slug: str) -> JSONResponse:
    if slug != RSH_SLUG:
        return JSONResponse({"message": "Roadmap not found"}, status_code=404)
    body = {
        "title": {"card": "E2E Roadmap", "page": "E2E Roadmap"},
        "description": "A synthetic roadmap for the e2e run.",
        "slug": slug,
        "type": "role",
        "nodes": RSH_NODES,
        "edges": [],
    }
    return JSONResponse(body)


@app.get("/github-api/rate_limit")
def github_rate_limit(request: Request) -> JSONResponse:
    auth = request.headers.get("authorization", "")
    if auth.split(" ")[-1] == RSH_TOKEN:
        return JSONResponse({"resources": {"core": {"limit": 5000, "remaining": 4999}}})
    return JSONResponse({"message": "Bad credentials"}, status_code=401)


@app.get("/roadmap-api/repos/nilbuild/developer-roadmap/git/trees/{commit}")
async def roadmap_tree(commit: str) -> JSONResponse:
    await asyncio.sleep(TREE_DELAY_S)
    if roadmap_state["fail"]:
        return JSONResponse({"message": "fake source failure"}, status_code=500)
    paths = set(_roadmap_files()) | (set(RSH_FILES) if commit == "master" else set())
    tree = [{"path": p, "type": "blob"} for p in sorted(paths)]
    return JSONResponse({"sha": commit, "truncated": False, "tree": tree})


@app.get("/roadmap-raw/nilbuild/developer-roadmap/{commit}/{path:path}")
def roadmap_raw(commit: str, path: str) -> PlainTextResponse:
    text = {**_roadmap_files(), **RSH_FILES}.get(path)
    if text is None:
        return PlainTextResponse("404: Not Found", status_code=404)
    return PlainTextResponse(text)

# --- fake Knowledge Hub: identity service (/kh-idp) and API (/kh-api) -----------------------------
KH_DEFAULTS: dict = {
    "decision": "pending",  # pending | approved | denied | expired: what the device code is
    "device_code": None,  # the code handed out by the last device request
    "answer": "Redis evicts keys by the policy in maxmemory-policy.",  # text of the search answer
    "search_status": 200,  # HTTP status of the search; 403/404 to simulate a refusal
    "search_message": "You may not read this project.",
    "email": "kh-user@example.test",
    "personal_project": "personal-e2e",
    "me_refuse": False,  # /auth/me answers 403: KH does not know the account
    "refresh_valid": [],  # refresh tokens the identity service accepts
    "access_valid": [],
    "revoked": [],  # refresh tokens that were revoked
    "device_requests": 0,
    "token_requests": 0,  # device-grant token requests (the polls that reached the service)
    "searches": [],  # {"project", "text", "bearer_ok"} of every search that arrived
    "counter": 0,
}
kh_state: dict = json.loads(json.dumps(KH_DEFAULTS))
KH_PUBLIC = "http://127.0.0.1:8002"


async def _form(request: Request) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs((await request.body()).decode("utf-8")).items()}


def _kh_tokens() -> dict:
    kh_state["counter"] += 1
    n = kh_state["counter"]
    access, refresh = f"fake-kh-access-{n}", f"fake-kh-refresh-{n}"
    kh_state["access_valid"].append(access)
    kh_state["refresh_valid"].append(refresh)
    return {"access_token": access, "refresh_token": refresh, "token_type": "Bearer", "expires_in": 300}


@app.post("/kh-control")
def kh_control(payload: dict) -> dict:
    """{"action": "approve" | "deny" | "expire" | "reset" | "end-signin"} plus optional settings:
    answer, search_status, search_message, email, personal_project, me_refuse."""
    action = payload.get("action")
    if action == "reset":
        kh_state.clear()
        kh_state.update(json.loads(json.dumps(KH_DEFAULTS)))
    elif action == "approve":
        kh_state["decision"] = "approved"
    elif action == "deny":
        kh_state["decision"] = "denied"
    elif action == "expire":
        kh_state["decision"] = "expired"
    elif action == "end-signin":  # the identity service no longer accepts the refresh tokens
        kh_state["refresh_valid"] = []
    for key in ("answer", "search_status", "search_message", "email", "personal_project", "me_refuse"):
        if key in payload:
            kh_state[key] = payload[key]
    return kh_state


@app.get("/kh-control")
def kh_control_state() -> dict:
    return kh_state


@app.post("/kh-idp/protocol/openid-connect/auth/device")
async def kh_device(request: Request) -> JSONResponse:
    form = await _form(request)
    if not form.get("client_id") or not form.get("code_challenge"):
        return JSONResponse({"error": "invalid_request"}, status_code=400)
    kh_state["counter"] += 1
    kh_state["device_requests"] += 1
    kh_state["decision"] = "pending"
    code = f"fake-kh-device-{kh_state['counter']}"
    kh_state["device_code"] = code
    user_code = f"KHE2E-{kh_state['counter']:04d}"
    page = f"{KH_PUBLIC}/kh-idp/device"
    return JSONResponse(
        {
            "device_code": code,
            "user_code": user_code,
            "verification_uri": page,
            "verification_uri_complete": f"{page}?user_code={user_code}",
            "expires_in": 600,
            "interval": 1,
        }
    )


@app.get("/kh-idp/device")
def kh_device_page(user_code: str = "") -> PlainTextResponse:
    return PlainTextResponse(f"Fake Knowledge Hub sign-in page. Code: {user_code}")


@app.post("/kh-idp/protocol/openid-connect/token")
async def kh_token(request: Request) -> JSONResponse:
    form = await _form(request)
    grant = form.get("grant_type", "")
    if grant.endswith("device_code"):
        kh_state["token_requests"] += 1
        if form.get("device_code") != kh_state["device_code"] or not form.get("code_verifier"):
            return JSONResponse({"error": "invalid_grant", "error_description": "Bad device code"}, status_code=400)
        decision = kh_state["decision"]
        if decision == "pending":
            return JSONResponse({"error": "authorization_pending"}, status_code=400)
        if decision == "denied":
            return JSONResponse({"error": "access_denied", "error_description": "The user refused."}, status_code=400)
        if decision == "expired":
            return JSONResponse({"error": "expired_token", "error_description": "Code expired."}, status_code=400)
        kh_state["device_code"] = None
        return JSONResponse(_kh_tokens())
    if grant == "refresh_token":
        token = form.get("refresh_token", "")
        if token not in kh_state["refresh_valid"]:
            return JSONResponse({"error": "invalid_grant", "error_description": "Token is not active"}, status_code=400)
        kh_state["refresh_valid"].remove(token)  # rotated: the old one is used up
        return JSONResponse(_kh_tokens())
    return JSONResponse({"error": "unsupported_grant_type"}, status_code=400)


@app.post("/kh-idp/protocol/openid-connect/revoke")
async def kh_revoke(request: Request) -> PlainTextResponse:
    form = await _form(request)
    token = form.get("token", "")
    kh_state["revoked"].append(token)
    if token in kh_state["refresh_valid"]:
        kh_state["refresh_valid"].remove(token)
    return PlainTextResponse("")


def _kh_bearer_ok(request: Request) -> bool:
    return request.headers.get("authorization", "").removeprefix("Bearer ") in kh_state["access_valid"]


@app.get("/kh-api/auth/me")
def kh_me(request: Request) -> JSONResponse:
    if not _kh_bearer_ok(request):
        return JSONResponse({"detail": "Not signed in"}, status_code=401)
    if kh_state["me_refuse"]:
        return JSONResponse({"detail": "No Knowledge Hub account for this person."}, status_code=403)
    return JSONResponse(
        {
            "email": kh_state["email"],
            "personal_project": kh_state["personal_project"],
            "role": "member",
            "projects": {kh_state["personal_project"]: ["read"]},
        }
    )


@app.post("/kh-api/flows/task.full-retrieve/run")
def kh_search(request: Request, payload: dict) -> JSONResponse:
    given = payload.get("input") or {}
    kh_state["searches"].append(
        {"project": given.get("space"), "text": given.get("text"), "bearer_ok": _kh_bearer_ok(request)}
    )
    if not _kh_bearer_ok(request):
        return JSONResponse({"detail": "Not signed in"}, status_code=401)
    if kh_state["search_status"] != 200:
        return JSONResponse({"detail": kh_state["search_message"]}, status_code=int(kh_state["search_status"]))
    return JSONResponse({"status": "done", "text": kh_state["answer"]})


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


SORT_KEYWORDS = (("kube", "Kubernetes"), ("career", "Career"), ("sql", "Databases"))


def _sort_answer(prompt: str) -> str:
    """The note sorter: JSON groups from the numbered notes ("N." then the wrapper, then
    "Title: <title>") of the prompt."""
    groups: dict[str, list[int]] = {}
    note = r"^(\d+)\.\n<untrusted_note_content>\nTitle: (.*)$"
    for number, title in re.findall(note, prompt, re.MULTILINE):
        for keyword, name in SORT_KEYWORDS:
            if keyword in title.lower():
                groups.setdefault(name, []).append(int(number))
                break
    return json.dumps({"groups": [{"name": n, "notes": v} for n, v in groups.items()]})


def _answer(payload: dict) -> str:
    messages = payload.get("messages") or []
    system = "\n".join(_text(m.get("content")) for m in messages if m.get("role") == "system")
    users = [_text(m.get("content")) for m in messages if m.get("role") == "user"]
    last = users[-1] if users else ""
    if system.startswith("You sort notes into groups"):
        return _sort_answer(last)
    if "[[markdown]]" in last:
        return MARKDOWN_ANSWER
    if "[[history]]" in last:
        # How much of the conversation the model received (chat-history: continue a session).
        return f"HISTORY user-messages={len(users)} first={users[0][:60]}"
    if "[[echo-tools]]" in last:
        # The tool names this request offered the model (area tool choices).
        names = sorted({(t.get("function") or {}).get("name") or "" for t in payload.get("tools") or []})
        return "TOOLS " + ",".join(n for n in names if n)
    found = re.search(r"\[\[echo-system\]\]\s*(\S+)", last)
    if found:
        # Whether the system prompt holds the given marker (area instructions).
        return f"SYSTEM has={'yes' if found.group(1) in system else 'no'}"
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


OUTLINE_TOPICS = [
    ("iam", "IAM", None),
    ("iam-policies", "IAM policies", "iam"),
    ("ec2", "EC2", None),
    ("ec2-instance-types", "EC2 instance types", "ec2"),
    ("s3", "S3", None),
    ("s3-storage-classes", "S3 storage classes", "s3"),
    ("vpc", "VPC", None),
    ("vpc-subnets", "VPC subnets", "vpc"),
]


def _outline_call(payload: dict) -> dict | None:
    """The propose_topics tool call the outline agent gets, until a tool result is in."""
    names = {(t.get("function") or {}).get("name") for t in payload.get("tools") or []}
    messages = payload.get("messages") or []
    if "propose_topics" not in names or any(m.get("role") == "tool" for m in messages):
        return None
    users = [_text(m.get("content")) for m in messages if m.get("role") == "user"]
    found = re.search(r"\(([a-z0-9-]+)\)", users[-1] if users else "")
    topics = [
        {"slug": slug, "title": title, "description": f"About {title}.", **({"parent": parent} if parent else {})}
        for slug, title, parent in OUTLINE_TOPICS
    ]
    arguments = json.dumps({"area": found.group(1) if found else "", "topics": topics})
    return {"id": "call_outline", "type": "function", "function": {"name": "propose_topics", "arguments": arguments}}


LEARN_RE = re.compile(r"\[\[learn:([^\]]+)\]\]")


def _learn(payload: dict) -> tuple[dict | None, str | None]:
    """[[learn:<title>]] in the last user message: one save_learned_note call, then a text answer.

    Returns (tool call, None) before the tool result of this turn is in, and (None, answer) after
    it: "LEARN saved <title>" or "LEARN refused <title>" by what the tool result said.
    """
    names = {(t.get("function") or {}).get("name") for t in payload.get("tools") or []}
    messages = payload.get("messages") or []
    last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=-1)
    found = LEARN_RE.search(_text(messages[last_user].get("content"))) if last_user >= 0 else None
    if not found or "save_learned_note" not in names:
        return None, None
    title, _, category = (part.strip() for part in found.group(1).partition("|"))
    results = [_text(m.get("content")) for m in messages[last_user + 1 :] if m.get("role") == "tool"]
    if results:
        saved = '"saved": true' in results[-1]
        return None, f"LEARN {'saved' if saved else 'refused'} {title}"
    markdown = (
        f"## Overview\n\n{title} is a topic written up by the fake model.\n\n"
        "## Takeaways\n\n- First point\n- Second point\n\n"
        "Raw tag: <script>alert(1)</script>\n"
    )
    args = {"title": title, "markdown": markdown}
    if category:
        args["category"] = category
    arguments = json.dumps(args)
    call = {"id": "call_learn", "type": "function", "function": {"name": "save_learned_note", "arguments": arguments}}
    return call, None


LESSON_RE = re.compile(r"\[\[lesson:([a-z0-9/-]+)\]\]")


def _write_lesson(payload: dict) -> tuple[dict | None, str | None]:
    """[[lesson:<domain/node>]] in the last user message (notifications e2e): one write_lesson call
    (only when the tool is offered), then "LESSON written" or "LESSON refused"."""
    names = {(t.get("function") or {}).get("name") for t in payload.get("tools") or []}
    messages = payload.get("messages") or []
    last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=-1)
    found = LESSON_RE.search(_text(messages[last_user].get("content"))) if last_user >= 0 else None
    if not found or "write_lesson" not in names:
        return None, None
    results = [_text(m.get("content")) for m in messages[last_user + 1 :] if m.get("role") == "tool"]
    if results:
        return None, "LESSON written" if '"saved": true' in results[-1] else "LESSON refused"
    arguments = json.dumps({"node_id": found.group(1), "markdown": "## Overview\n\nA lesson written by the fake model.\n"})
    return {"id": "call_lesson", "type": "function", "function": {"name": "write_lesson", "arguments": arguments}}, None


KH_RE = re.compile(r"\[\[kh:([^\]|]+)(?:\|([^\]]+))?\]\]")


def _kh(payload: dict) -> tuple[dict | None, str | None]:
    """[[kh:<query>]] / [[kh:<query>|<project>]] in the last user message: one kh_search call (only
    when the tool is offered), then a text answer built from the tool result."""
    names = {(t.get("function") or {}).get("name") for t in payload.get("tools") or []}
    messages = payload.get("messages") or []
    last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=-1)
    found = KH_RE.search(_text(messages[last_user].get("content"))) if last_user >= 0 else None
    if not found or "kh_search" not in names:
        return None, None
    results = [_text(m.get("content")) for m in messages[last_user + 1 :] if m.get("role") == "tool"]
    if results:
        try:
            data = json.loads(results[-1])
        except ValueError:
            return None, "KH error unreadable result"
        if "error" in data:
            return None, f"KH error {data['error']}"
        shown = str(data.get("text", "")).replace("<", "[").replace(">", "]").replace("\n", " / ")
        return None, f"KH ok project={data.get('project')} truncated={str(data.get('truncated')).lower()} {shown}"
    args: dict = {"query": found.group(1).strip()}
    if found.group(2):
        args["project"] = found.group(2).strip()
    call = {"id": "call_kh", "type": "function", "function": {"name": "kh_search", "arguments": json.dumps(args)}}
    return call, None


ROADMAP_RE = re.compile(r"\[\[roadmap:([^\]]+)\]\]")


def _roadmapsh(payload: dict) -> tuple[dict | None, str | None]:
    """[[roadmap:<slug>]] in the last user message (roadmap-explorer e2e): roadmapsh_list, then
    roadmapsh_outline(<slug>), then roadmapsh_topic for the first node id of the outline, then
    "ROADMAP ok ..." built from the three results; any tool error ends it with "ROADMAP error <message>"."""
    names = {(t.get("function") or {}).get("name") for t in payload.get("tools") or []}
    messages = payload.get("messages") or []
    last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=-1)
    found = ROADMAP_RE.search(_text(messages[last_user].get("content"))) if last_user >= 0 else None
    if not found or "roadmapsh_list" not in names:
        return None, None
    slug = found.group(1).strip()
    results = [_text(m.get("content")) for m in messages[last_user + 1 :] if m.get("role") == "tool"]
    data = []
    for r in results:
        try:
            data.append(json.loads(r))
        except ValueError:
            return None, "ROADMAP error unreadable result"
        if "error" in data[-1]:
            return None, f"ROADMAP error {data[-1]['error']}"

    def call(name: str, args: dict) -> dict:
        return {"id": f"call_{name}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}

    if len(data) == 0:
        return call("roadmapsh_list", {}), None
    if len(data) == 1:
        return call("roadmapsh_outline", {"slug": slug}), None
    node = re.search(r"\(id ([A-Za-z0-9_-]+)\)", str(data[1].get("text", "")))
    if len(data) == 2:
        return call("roadmapsh_topic", {"slug": slug, "node_id": node.group(1) if node else "none"}), None

    def shown(value: object) -> str:
        return str(value).replace("<", "[").replace(">", "]").replace("\n", " / ")

    slugs = ",".join(r["slug"] for r in data[0]["roadmaps"])
    return None, f"ROADMAP ok slugs={slugs} outline={shown(data[1]['text'])} topic={shown(data[2]['text'])}"


# "quiz me" not followed by a colon: the /quiz skill expands to "Quiz me: write 5 questions ..."
INTERACTIVE_TRIGGERS = (
    (re.compile(r"quiz me\b(?!:)", re.IGNORECASE), "quiz"),
    (re.compile(r"practice", re.IGNORECASE), "practice"),
    (re.compile(r"interactive lesson", re.IGNORECASE), "lesson"),
)
INTERACTIVE_DONE = {"quiz": "Here is your quiz.", "practice": "Here is your practice.", "lesson": "Here is your lesson."}
XSS_QUESTION = 'Which driver? <img src=x onerror="window.__xss=1"> ![t](https://tracker.example/p.png)'


def _quiz_content() -> dict:
    questions = [
        {
            "text": text,
            "options": ["Option one", "Option two", "Option three"],
            "answer": 2,
            "explanation": f"Explanation {n}.",
        }
        for n, text in enumerate(["Which network mode is the default?", "How do containers find each other?", XSS_QUESTION], 1)
    ]
    return {"title": "Docker networking quiz", "questions": questions}


def _lesson_content() -> dict:
    check = {
        "text": "Where do volumes live?",
        "options": ["Inside the container", "Outside the container"],
        "answer": 2,
        "explanation": "Volumes live outside the container.",
    }
    return {
        "title": "Docker volumes",
        "sections": [
            {"kind": "concept", "heading": "What is a volume", "body": "A volume keeps data after a container ends."},
            {"kind": "concept", "heading": "Why", "body": "Data must outlive the container."},
            {"kind": "example", "heading": "Try it", "body": "Run `docker volume create data`."},
            {"kind": "check", "heading": "Check yourself", "question": check},
        ],
    }


def _a2ui(payload: dict) -> tuple[dict | None, str | None]:
    """The interactive tutor scripts: show_interactive from "quiz me" / "practice" / "interactive
    lesson" (chat agent), and make_quiz / make_lesson (the a2ui agent, found by its offered tools)."""
    names = {(t.get("function") or {}).get("name") for t in payload.get("tools") or []}
    messages = payload.get("messages") or []
    last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=-1)
    text = _text(messages[last_user].get("content")) if last_user >= 0 else ""
    results = [_text(m.get("content")) for m in messages[last_user + 1 :] if m.get("role") == "tool"]
    for tool, content in (("make_quiz", _quiz_content), ("make_lesson", _lesson_content)):
        if tool in names:
            if results:
                return None, "Done."
            call = {"id": f"call_{tool}", "type": "function", "function": {"name": tool, "arguments": json.dumps(content())}}
            return call, None
    if "show_interactive" not in names:
        return None, None
    hit = next(((rx, kind) for rx, kind in INTERACTIVE_TRIGGERS if rx.search(text)), None)
    if hit is None:
        return None, None
    rx, kind = hit
    if results:
        try:
            error = json.loads(results[-1]).get("error")
        except (ValueError, AttributeError):
            error = None
        return None, f"I could not make it: {error}" if error else INTERACTIVE_DONE[kind]
    rest = rx.sub(" ", text, count=1).strip(" \t\r\n.,;:!?")
    args: dict = {"kind": kind, "topic": rest or "docker networking"}
    if kind != "lesson":
        args["count"] = 3
    call = {"id": "call_interactive", "type": "function", "function": {"name": "show_interactive", "arguments": json.dumps(args)}}
    return call, None


def _cut(payload: dict) -> tuple[dict | None, str | None, bool]:
    """[[cut]] / [[cut-text]] in the last user message: answers cut by the output limit.

    [[cut]]: one write_lesson call with empty input and finish_reason "length"; once a tool result
    is in, the text "CUT recovered". [[cut-text]]: a text answer with finish_reason "length".
    Returns (tool call, text, cut), with cut True when finish_reason must be "length".
    """
    messages = payload.get("messages") or []
    last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=-1)
    if last_user < 0:
        return None, None, False
    text = _text(messages[last_user].get("content"))
    if "[[cut-text]]" in text:
        return None, "CUT text answer that was stopped", True
    if "[[cut]]" not in text:
        return None, None, False
    if any(m.get("role") == "tool" for m in messages[last_user + 1 :]):
        return None, "CUT recovered", False
    call = {"id": "call_cut", "type": "function", "function": {"name": "write_lesson", "arguments": "{}"}}
    return call, None, True


SLOW_RE = re.compile(r"\[\[slow-tool:([A-Za-z0-9_-]+)\]\]")
slow_calls: dict[str, int] = {}  # run marker -> model calls seen (GET /slow-control)
SLOW_DELAY_S = 4


@app.get("/slow-control")
def slow_control() -> dict:
    return slow_calls


async def _slow(payload: dict) -> tuple[dict | None, str | None]:
    """[[slow-tool:<marker>]] in the last user message (agent-stop e2e): the first model call asks
    for a search_notes call at once, the second waits SLOW_DELAY_S seconds and asks for another one,
    the third answers "SLOW done". Gives the test a window in which a stop lands between two calls."""
    names = {(t.get("function") or {}).get("name") for t in payload.get("tools") or []}
    messages = payload.get("messages") or []
    last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=-1)
    found = SLOW_RE.search(_text(messages[last_user].get("content"))) if last_user >= 0 else None
    if not found or "search_notes" not in names:
        return None, None
    marker = found.group(1)
    slow_calls[marker] = slow_calls.get(marker, 0) + 1
    results = sum(1 for m in messages[last_user + 1 :] if m.get("role") == "tool")
    if results >= 2:
        return None, "SLOW done"
    if results == 1:
        await asyncio.sleep(SLOW_DELAY_S)
    args = json.dumps({"query": f"{marker}-{results + 1}"})
    return {"id": f"call_slow{results}", "type": "function", "function": {"name": "search_notes", "arguments": args}}, None


def error_response(status: int, kind: str, message: str, code: str | None) -> JSONResponse:
    body = {"error": {"message": message, "type": kind, "param": None, "code": code}}
    return JSONResponse(body, status_code=status)


@app.get("/v1/models")
def list_models() -> dict:
    return {
        "object": "list",
        "data": [{"id": m, "object": "model", "created": 0, "owned_by": "fake"} for m in MODELS],
    }


# A user message holding this marker gets its streamed answer slowly, word by word.
SLOW_STREAM = "[[slowstream]]"
SLOW_STREAM_DELAY_S = 0.4


async def _stream(payload: dict, model: str, message: dict, finish: str):
    """The same answer as server-sent chunks, the way OpenAI streams: text word by word, each
    tool call in one chunk, then the finish reason."""
    users = [m for m in payload.get("messages") or [] if m.get("role") == "user"]
    slow = bool(users) and SLOW_STREAM in str(users[-1].get("content"))

    def chunk(delta: dict, reason: str | None = None) -> str:
        body = {
            "id": "chatcmpl-fake",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": reason}],
        }
        return f"data: {json.dumps(body)}\n\n"

    yield chunk({"role": "assistant"})
    words = re.findall(r"\S+\s*", message.get("content") or "")
    for word in words:
        if slow:
            await asyncio.sleep(SLOW_STREAM_DELAY_S)
        yield chunk({"content": word})
    for i, call in enumerate(message.get("tool_calls") or []):
        yield chunk({"tool_calls": [{"index": i, **call}]})
    yield chunk({}, finish)
    yield "data: [DONE]\n\n"


@app.post("/v1/chat/completions")
async def chat_completions(payload: dict) -> JSONResponse:
    model = str(payload.get("model", ""))
    if model in ERRORS:
        return error_response(*ERRORS[model])
    if model == "fake-slow":
        await asyncio.sleep(5)
    elif model != "fake-ok":
        return error_response(404, "invalid_request_error", f"The model `{model}` does not exist", "model_not_found")
    call = _outline_call(payload)
    learn_call, learn_text = _learn(payload)
    cut_call, cut_text, cut = _cut(payload)
    kh_call, kh_text = _kh(payload)
    rsh_call, rsh_text = _roadmapsh(payload)
    lesson_call, lesson_text = _write_lesson(payload)
    ui_call, ui_text = _a2ui(payload)
    slow_call, slow_text = await _slow(payload)
    if slow_call is not None:
        message = {"role": "assistant", "content": None, "tool_calls": [slow_call]}
        finish = "tool_calls"
    elif slow_text is not None:
        message = {"role": "assistant", "content": slow_text}
        finish = "stop"
    elif ui_call is not None:
        message = {"role": "assistant", "content": None, "tool_calls": [ui_call]}
        finish = "tool_calls"
    elif ui_text is not None:
        message = {"role": "assistant", "content": ui_text}
        finish = "stop"
    elif lesson_call is not None:
        message = {"role": "assistant", "content": None, "tool_calls": [lesson_call]}
        finish = "tool_calls"
    elif lesson_text is not None:
        message = {"role": "assistant", "content": lesson_text}
        finish = "stop"
    elif rsh_call is not None:
        message = {"role": "assistant", "content": None, "tool_calls": [rsh_call]}
        finish = "tool_calls"
    elif rsh_text is not None:
        message = {"role": "assistant", "content": rsh_text}
        finish = "stop"
    elif kh_call is not None:
        message = {"role": "assistant", "content": None, "tool_calls": [kh_call]}
        finish = "tool_calls"
    elif kh_text is not None:
        message = {"role": "assistant", "content": kh_text}
        finish = "stop"
    elif cut_call is not None:
        message = {"role": "assistant", "content": None, "tool_calls": [cut_call]}
        finish = "length"
    elif cut_text is not None:
        message = {"role": "assistant", "content": cut_text}
        finish = "length" if cut else "stop"
    elif learn_call is not None:
        message = {"role": "assistant", "content": None, "tool_calls": [learn_call]}
        finish = "tool_calls"
    elif learn_text is not None:
        message = {"role": "assistant", "content": learn_text}
        finish = "stop"
    elif call is not None:
        message: dict = {"role": "assistant", "content": None, "tool_calls": [call]}
        finish = "tool_calls"
    else:
        text = "Proposed topics for review." if "propose_topics" in json.dumps(payload.get("tools") or []) else _answer(payload)
        message = {"role": "assistant", "content": text}
        finish = "stop"
    if payload.get("stream"):
        return StreamingResponse(_stream(payload, model, message, finish), media_type="text/event-stream")
    return JSONResponse(
        {
            "id": "chatcmpl-fake",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model,
            "choices": [
                {"index": 0, "message": message, "finish_reason": finish}
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 3, "total_tokens": 4},
        }
    )
