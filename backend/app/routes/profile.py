"""Profile routes (change settings-tabs): avatar, email change, and linking sign-in methods.

Every route needs a session; every POST and DELETE also the app header. Nothing here logs or
returns a token, and an avatar is untrusted bytes: checked by content, served only as an image.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import tokens
from app.auth.accounts import release_avatar
from app.auth.mail import Mail
from app.auth.oauth import (
    PENDING_COOKIE,
    PENDING_SECONDS,
    PendingStore,
    ProviderName,
    authorize_url,
    provider_config,
)
from app.auth.schemas import EmailIn, MeOut, MessageOut, TokenIn
from app.auth.sessions import clock_of, end_sessions, find_session, is_secure
from app.db import OAuthAccount, User, get_session
from app.routes.auth import (
    EMAIL_TAKEN,
    INVALID_LINK,
    SignedDep,
    limit,
    link,
    me_out,
    send_mail,
    settings_of,
)
from app.routes.guard import box_of, require_app_header
from app.storage import FileStore, sha256_hex

router = APIRouter(prefix="/api/auth", tags=["profile"])

guarded = [Depends(require_app_header)]
DbDep = Annotated[Session, Depends(get_session)]

MAX_AVATAR_BYTES = 1024 * 1024
AVATAR_TYPES = "Use a PNG, JPEG or WebP image."
AVATAR_TOO_BIG = "The image is larger than 1 MB."
SAME_EMAIL = "This is already your email."
EMAIL_CHANGE_SENT = "We sent a link to the new address. Your email changes when you open it."
LAST_METHOD = "This is your only way to sign in. Add another method first."
NOT_LINKED = "This sign-in method is not linked."
SECURITY_ROUTE = "#/profile/security"


def avatar_type(data: bytes) -> tuple[str, str] | None:
    """(content type, file suffix) from the magic bytes; None for anything else."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", ".webp"
    return None


AVATAR_CONTENT_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}


@router.post("/avatar", response_model=MeOut, dependencies=guarded)
def upload_avatar(
    signed: SignedDep, request: Request, db: DbDep, file: Annotated[UploadFile, File()]
) -> MeOut:
    # Read at most one byte over the limit: a large body is never held in memory.
    data = file.file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=413, detail=AVATAR_TOO_BIG)
    kind = avatar_type(data)
    if kind is None:
        raise HTTPException(status_code=415, detail=AVATAR_TYPES)
    store: FileStore = request.app.state.store
    key = f"avatars/{sha256_hex(data)}{kind[1]}"
    store.put(key, data)
    user = signed.user
    old, user.avatar_key = user.avatar_key, key
    db.flush()
    if old != key:
        release_avatar(db, store, old)
    db.commit()
    return me_out(db, user)


@router.delete("/avatar", response_model=MeOut, dependencies=guarded)
def remove_avatar(signed: SignedDep, request: Request, db: DbDep) -> MeOut:
    user = signed.user
    old, user.avatar_key = user.avatar_key, None
    db.flush()
    release_avatar(db, request.app.state.store, old)
    db.commit()
    return me_out(db, user)


@router.get("/avatar/{user_id}", response_model=None)
def read_avatar(user_id: UUID, signed: SignedDep, request: Request, db: DbDep) -> Response:
    """The user's own avatar, or any user's for the admin; 404 otherwise."""
    if user_id != signed.user.id and signed.user.role != "admin":
        raise HTTPException(status_code=404, detail="avatar not found")
    owner = db.get(User, user_id)
    key = owner.avatar_key if owner is not None else None
    media = AVATAR_CONTENT_TYPES.get(key[key.rfind(".") :]) if key else None
    if key is None or media is None:
        raise HTTPException(status_code=404, detail="avatar not found")
    store: FileStore = request.app.state.store
    try:
        data = store.get(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="avatar not found") from exc
    return Response(
        content=data,
        media_type=media,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cache-Control": "private, max-age=86400",
        },
    )


# --- email change


@router.post("/email", response_model=MessageOut, dependencies=guarded)
def request_email_change(
    body: EmailIn, signed: SignedDep, request: Request, db: DbDep
) -> MessageOut:
    """Send a link to the new address and a notice to the old one. The answer is the same
    whether the new address is free or not; only the confirm step refuses a taken one."""
    user = signed.user
    new_email = body.email.strip().lower()
    limit(request, "email-change", user.email)
    if new_email == user.email:
        raise HTTPException(status_code=422, detail=SAME_EMAIL)
    token = tokens.issue(db, "change_email", user, clock_of(request)(), email=new_email)
    db.commit()
    send_mail(
        request,
        Mail(
            to=new_email,
            subject="Confirm your new email for Learning Hub",
            body=(
                "Open this link to make this address the email of your Learning Hub account. "
                f"It works once, within 24 hours:\n\n{link(request, 'email-change', token)}\n\n"
                "If you did not ask for this, ignore this message.\n"
            ),
            purpose="change-email",
        ),
    )
    send_mail(
        request,
        Mail(
            to=user.email,
            subject="Your Learning Hub email is about to change",
            body=(
                "Someone signed in to your Learning Hub account asked to change its email. "
                "Nothing changes until the link sent to the new address is opened. If this "
                "was not you, change your password and log out everywhere else.\n"
            ),
            purpose="change-email-notice",
        ),
    )
    return MessageOut(message=EMAIL_CHANGE_SENT)


@router.post("/email/confirm", response_model=MeOut, dependencies=guarded)
def confirm_email_change(body: TokenIn, request: Request, db: DbDep) -> MeOut:
    limit(request, "email-confirm")
    now = clock_of(request)()
    used = tokens.consume(db, "change_email", body.token, now)
    user = db.get(User, used.user_id) if used and used.user_id else None
    if used is None or user is None:
        db.rollback()
        raise HTTPException(status_code=400, detail=INVALID_LINK)
    taken = db.scalar(select(User.id).where(User.email == used.email, User.id != user.id))
    if taken is not None:
        db.rollback()
        raise HTTPException(status_code=409, detail=EMAIL_TAKEN)
    user.email = used.email
    user.email_verified_at = now
    # Other browsers signed in with the old email are signed out; this one stays if it is
    # the same user's.
    current = find_session(db, request)
    end_sessions(db, user, keep=current.session if current and current.user.id == user.id else None)
    db.commit()
    return me_out(db, user)


# --- linked sign-in methods


@router.get("/oauth/{provider}/link", response_model=None)
def oauth_link_start(
    provider: ProviderName, signed: SignedDep, request: Request, db: DbDep
) -> RedirectResponse:
    """Start linking GitHub or Google to the signed-in user. The pending flow remembers the
    user, and the callback links only for that same signed-in user."""
    settings = settings_of(request)
    base = settings.public_url.rstrip("/")
    config = provider_config(settings, provider, db, box_of(request))
    if config is None:
        return RedirectResponse(f"{base}/{SECURITY_ROUTE}?error=not_configured", status_code=302)
    store: PendingStore = request.app.state.oauth_pending
    key, pending = store.start(provider, SECURITY_ROUTE, link_user_id=signed.user.id)
    response = RedirectResponse(authorize_url(settings, config, pending), status_code=302)
    response.set_cookie(
        PENDING_COOKIE,
        key,
        max_age=PENDING_SECONDS,
        path="/api/auth/oauth",
        httponly=True,
        samesite="lax",
        secure=is_secure(request, settings),
    )
    return response


@router.delete("/identities/{provider}", response_model=MeOut, dependencies=guarded)
def unlink(provider: ProviderName, signed: SignedDep, db: DbDep) -> MeOut:
    user = signed.user
    accounts = db.scalars(select(OAuthAccount).where(OAuthAccount.user_id == user.id)).all()
    if not any(a.provider == provider for a in accounts):
        raise HTTPException(status_code=404, detail=NOT_LINKED)
    others = sum(1 for a in accounts if a.provider != provider)
    if user.password_hash is None and others == 0:
        raise HTTPException(status_code=422, detail=LAST_METHOD)
    db.execute(
        delete(OAuthAccount).where(
            OAuthAccount.user_id == user.id, OAuthAccount.provider == provider
        )
    )
    db.commit()
    return me_out(db, user)
