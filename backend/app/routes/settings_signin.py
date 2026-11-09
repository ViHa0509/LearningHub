"""Sign-in settings: the GitHub and Google client ID and secret, saved in the app.

The secret is stored encrypted and never returned; only its hint is. Saved values win over
the environment (see ``app.auth.oauth.provider_config``) and work without a restart.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agent.secrets import SecretUnreadable, key_hint
from app.auth.oauth import ProviderName, redirect_uri
from app.config import Settings
from app.db import AppSetting, get_session
from app.routes.guard import box_of, require_app_header

router = APIRouter(prefix="/api/settings/sign-in", tags=["settings"])
guarded = [Depends(require_app_header)]
DbDep = Annotated[Session, Depends(get_session)]

MAX_VALUE = 200
PROVIDERS: tuple[ProviderName, ...] = ("github", "google")


class SignInIn(BaseModel):
    client_id: str = Field(default="", max_length=MAX_VALUE)
    client_secret: str | None = Field(default=None, max_length=MAX_VALUE)


class ProviderOut(BaseModel):
    client_id: str | None
    secret_hint: str | None
    source: Literal["app", "env"] | None
    callback_url: str


class SignInOut(BaseModel):
    public_url: str
    providers: dict[str, ProviderOut]


def known(provider: str) -> ProviderName:
    if provider == "github":
        return "github"
    if provider == "google":
        return "google"
    raise HTTPException(status_code=404, detail="unknown sign-in provider")


def _settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def _env_values(settings: Settings, name: ProviderName) -> tuple[str, str] | None:
    if name == "github":
        client_id, secret = settings.github_client_id, settings.github_client_secret
    else:
        client_id, secret = settings.google_client_id, settings.google_client_secret
    if not client_id or not client_id.strip() or secret is None:
        return None
    value = secret.get_secret_value().strip()
    return (client_id.strip(), value) if value else None


def _provider_out(request: Request, db: Session, name: ProviderName) -> ProviderOut:
    settings = _settings(request)
    callback = redirect_uri(settings, name)
    row = db.get(AppSetting, f"oauth.{name}")
    if row is not None:
        client_id = row.value.get("client_id")
        hint = "…"
        if row.secret_enc is not None:
            try:
                hint = key_hint(box_of(request).decrypt(row.secret_enc))
            except SecretUnreadable:
                hint = "…"
        return ProviderOut(
            client_id=client_id if isinstance(client_id, str) else None,
            secret_hint=hint,
            source="app",
            callback_url=callback,
        )
    env = _env_values(settings, name)
    if env is not None:
        return ProviderOut(
            client_id=env[0], secret_hint=key_hint(env[1]), source="env", callback_url=callback
        )
    return ProviderOut(client_id=None, secret_hint=None, source=None, callback_url=callback)


def _read(request: Request, db: Session) -> SignInOut:
    return SignInOut(
        public_url=_settings(request).public_url.rstrip("/"),
        providers={name: _provider_out(request, db, name) for name in PROVIDERS},
    )


@router.get("", response_model=SignInOut)
def read_sign_in(request: Request, db: DbDep) -> SignInOut:
    return _read(request, db)


@router.put("/{provider}", response_model=SignInOut, dependencies=guarded)
def save_sign_in(provider: str, body: SignInIn, request: Request, db: DbDep) -> SignInOut:
    provider = known(provider)
    client_id = body.client_id.strip()
    secret = (body.client_secret or "").strip()
    if not client_id:
        raise HTTPException(status_code=422, detail="the Client ID is required")
    key = f"oauth.{provider}"
    row = db.get(AppSetting, key)
    if secret:
        encrypted = box_of(request).encrypt(secret)
    elif row is not None and row.secret_enc is not None:
        encrypted = row.secret_enc
    else:
        raise HTTPException(status_code=422, detail="the Client secret is required")
    if row is None:
        db.add(AppSetting(key=key, value={"client_id": client_id}, secret_enc=encrypted))
    else:
        row.value = {"client_id": client_id}
        row.secret_enc = encrypted
    db.commit()
    return _read(request, db)


@router.delete("/{provider}", status_code=204, dependencies=guarded)
def remove_sign_in(provider: str, db: DbDep) -> Response:
    provider = known(provider)
    row = db.get(AppSetting, f"oauth.{provider}")
    if row is not None:
        db.delete(row)
        db.commit()
    return Response(status_code=204)
