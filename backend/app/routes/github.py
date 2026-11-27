"""The user's optional GitHub token for the roadmap.sh explorer (design 5-6).

The token is checked with GitHub before it is saved, stored encrypted, and never logged or
returned; answers show only its hint.
"""

import re
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.agent.secrets import key_hint
from app.auth.current import CurrentUser
from app.db import GithubToken, get_session
from app.resources.sync import USER_AGENT
from app.routes.guard import box_of, require_app_header

router = APIRouter(prefix="/api/github", tags=["github"])
guarded = [Depends(require_app_header)]
TOKEN = re.compile(r"^[A-Za-z0-9_]{20,255}$")
TIMEOUT_S = 10.0

# url, token -> HTTP status, or None when GitHub did not answer.
TokenCheck = Callable[[str, str], int | None]


def github_status(url: str, token: str) -> int | None:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
    }
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, headers=headers), timeout=TIMEOUT_S
        ) as r:
            return int(r.status)
    except urllib.error.HTTPError as exc:
        return exc.code
    except (urllib.error.URLError, OSError):  # TimeoutError is an OSError
        return None


class TokenIn(BaseModel):
    # Checked by hand: a pydantic pattern error would echo the token in the 422 answer.
    token: str


class StatusOut(BaseModel):
    saved: bool
    hint: str | None


@router.get("")
def get_status(session: Annotated[Session, Depends(get_session)], user: CurrentUser) -> StatusOut:
    row = session.get(GithubToken, user.id)
    return StatusOut(saved=row is not None, hint=row.token_hint if row else None)


@router.put("", dependencies=guarded)
def save(
    payload: TokenIn,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    user: CurrentUser,
) -> StatusOut:
    token = payload.token
    if not TOKEN.match(token):
        raise HTTPException(
            status_code=422, detail="a GitHub token is 20 to 255 letters, digits or '_'"
        )
    check: TokenCheck = request.app.state.github_check
    base = request.app.state.settings.github_api_base.rstrip("/")
    status = check(f"{base}/rate_limit", token)
    if status == 401:
        raise HTTPException(status_code=400, detail="GitHub refused this token")
    if status != 200:
        raise HTTPException(status_code=502, detail="GitHub did not answer")
    row = session.get(GithubToken, user.id)
    if row is None:
        row = GithubToken(user_id=user.id)
        session.add(row)
    row.token_enc = box_of(request).encrypt(token)
    row.token_hint = key_hint(token)
    session.commit()
    return StatusOut(saved=True, hint=row.token_hint)


@router.delete("", status_code=204, dependencies=guarded)
def remove(session: Annotated[Session, Depends(get_session)], user: CurrentUser) -> Response:
    row = session.get(GithubToken, user.id)
    if row is not None:
        session.delete(row)
        session.commit()
    return Response(status_code=204)
