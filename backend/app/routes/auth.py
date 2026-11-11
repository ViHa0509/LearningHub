"""The login: email and password, magic links, email verification, sessions, OAuth.

These routes work whether or not ``auth_required`` is on. Every POST needs the app header.
Nothing here returns or logs a password, a cookie token or an emailed token.
"""

import hmac
import re
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import invitations, tokens
from app.auth.mail import Mail, Mailer, send_quietly
from app.auth.oauth import (
    PENDING_COOKIE,
    PENDING_SECONDS,
    Identity,
    OAuthError,
    PendingStore,
    ProviderName,
    authorize_url,
    fetch_identity,
    provider_config,
)
from app.auth.passwords import MIN_LENGTH, burn_time, hash_password, verify_password
from app.auth.ratelimit import AuthLimiter
from app.auth.schemas import (
    AcceptIn,
    AuthStatus,
    EmailIn,
    InvitationInfo,
    LoginIn,
    MailStatus,
    MeOut,
    MessageOut,
    PasswordChangeIn,
    ProviderStatus,
    ResetIn,
    RevokedOut,
    SessionOut,
    SignupIn,
    TokenIn,
    VerifiedOut,
)
from app.auth.sessions import (
    Signed,
    clear_session_cookie,
    client_ip,
    clock_of,
    create_session,
    end_sessions,
    find_session,
    is_secure,
    require_signed,
    set_session_cookie,
)
from app.config import Settings
from app.db import OAuthAccount, User, UserSession, get_session
from app.routes.guard import box_of, require_app_header

router = APIRouter(prefix="/api/auth", tags=["auth"])

guarded = [Depends(require_app_header)]
DbDep = Annotated[Session, Depends(get_session)]

INVITE_REQUIRED = "You need an invitation to join"
DISABLED = "This account is disabled"
INVALID_INVITATION = "This invitation has expired or was already used."
WRONG_LOGIN = "Wrong email or password"
INVALID_LINK = "This link is invalid or has expired. Ask for a new one."
FORGOT_SENT = "If that email belongs to the owner, a reset link is on its way."
MAGIC_SENT = "If that email belongs to the owner, a sign-in link is on its way."
VERIFY_SENT = "A verification link is on its way."
ALREADY_VERIFIED = "Your email is verified already."
SHORT_PASSWORD = f"Use at least {MIN_LENGTH} characters for the password."
BAD_EMAIL = "Enter a valid email address."
WRONG_CURRENT = "The current password is wrong."

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def settings_of(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def signed_in(request: Request, response: Response, db: DbDep) -> Signed:
    return require_signed(request, response, db)


SignedDep = Annotated[Signed, Depends(signed_in)]


def normalize_email(value: str) -> str:
    return value.strip().lower()


def limit(request: Request, action: str, email: str | None = None) -> None:
    keys = [f"{action}:ip:{client_ip(request)}"]
    if email:
        keys.append(f"{action}:email:{email}")
    limiter: AuthLimiter = request.app.state.auth_limiter
    wait = limiter.hit(keys)
    if wait is not None:
        raise HTTPException(
            status_code=429,
            detail=f"Too many attempts. Try again in {wait} seconds.",
            headers={"Retry-After": str(wait)},
        )


def check_password(password: str) -> None:
    if len(password) < MIN_LENGTH:
        raise HTTPException(status_code=400, detail=SHORT_PASSWORD)


def me_out(db: Session, user: User) -> MeOut:
    linked = db.scalars(
        select(OAuthAccount.provider)
        .where(OAuthAccount.user_id == user.id)
        .order_by(OAuthAccount.provider)
    ).all()
    return MeOut(
        id=user.id,
        email=user.email,
        email_verified=user.email_verified_at is not None,
        role=user.role,
        display_name=user.display_name,
        bio=user.bio,
        # Avatar upload is not served yet; the frontend shows initials.
        avatar_url=None,
        has_password=user.password_hash is not None,
        linked=sorted(set(linked)),
    )


def real_users(db: Session) -> int:
    """Accounts that can sign in; the no-login placeholder admin does not count."""
    return db.scalar(select(func.count()).select_from(User).where(User.placeholder.is_(False))) or 0


def make_admin(
    db: Session,
    email: str,
    now: datetime,
    *,
    password_hash: str | None = None,
    display_name: str | None = None,
    verified: bool = False,
) -> User:
    """The admin account (not committed): takes over the placeholder row when there is one,
    so the data it owns stays with the admin."""
    admin = db.scalar(select(User).where(User.placeholder.is_(True)))
    if admin is None:
        admin = User(preferences={})
        db.add(admin)
    admin.email = email
    admin.role = "admin"
    admin.placeholder = False
    admin.password_hash = password_hash
    admin.display_name = display_name
    admin.email_verified_at = now if verified else None
    return admin


def owner_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def link(request: Request, kind: str, token: str) -> str:
    base = settings_of(request).public_url.rstrip("/")
    return f"{base}/#/auth/{kind}?token={token}"


def queue_mail(request: Request, background: BackgroundTasks, mail: Mail) -> None:
    mailer: Mailer = request.app.state.mailer
    background.add_task(send_quietly, mailer, mail)


def verify_mail(request: Request, user: User, token: str) -> Mail:
    return Mail(
        to=user.email,
        subject="Verify your email for Learning Hub",
        body=(
            "Open this link to verify the email of your Learning Hub account:\n\n"
            f"{link(request, 'verify', token)}\n\nIf you did not create the account, "
            "ignore this message.\n"
        ),
        purpose="verify-email",
    )


def start_session(db: Session, user: User, request: Request, response: Response) -> None:
    if user.disabled_at is not None:
        raise HTTPException(status_code=403, detail=DISABLED)
    token = create_session(db, user, request)
    db.commit()
    set_session_cookie(response, request, token)


# --- status and profile


@router.get("/status", response_model=AuthStatus)
def status(request: Request, db: DbDep) -> AuthStatus:
    settings = settings_of(request)
    mailer: Mailer = request.app.state.mailer
    has_owner = real_users(db) > 0
    return AuthStatus(
        auth_required=settings.auth_required,
        has_owner=has_owner,
        providers={
            name: ProviderStatus(
                configured=provider_config(settings, name, db, box_of(request)) is not None
            )
            for name in ("github", "google")
        },
        mail=MailStatus(mode=mailer.mode),
    )


@router.get("/me", response_model=MeOut)
def me(signed: SignedDep, db: DbDep) -> MeOut:
    return me_out(db, signed.user)


# --- email and password


@router.post("/signup", response_model=MeOut, status_code=201, dependencies=guarded)
def signup(
    body: SignupIn,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: DbDep,
) -> MeOut:
    email = normalize_email(body.email)
    limit(request, "signup", email)
    if real_users(db) > 0:
        raise HTTPException(status_code=403, detail=INVITE_REQUIRED)
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail=BAD_EMAIL)
    check_password(body.password)
    name = (body.display_name or "").strip() or None
    user = make_admin(
        db,
        email,
        clock_of(request)(),
        password_hash=hash_password(body.password),
        display_name=name,
    )
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=403, detail=INVITE_REQUIRED) from None
    verify_token = tokens.issue(db, "verify_email", user, clock_of(request)())
    start_session(db, user, request, response)
    queue_mail(request, background, verify_mail(request, user, verify_token))
    return me_out(db, user)


@router.get("/invitation", response_model=InvitationInfo)
def invitation_info(
    request: Request, db: DbDep, token: Annotated[str, Query(max_length=200)] = ""
) -> InvitationInfo:
    found = invitations.find_pending_by_token(db, token, clock_of(request)())
    if found is None:
        raise HTTPException(status_code=404, detail=INVALID_INVITATION)
    return InvitationInfo(email=found.email, expires_at=found.expires_at)


@router.post("/invitation/accept", response_model=MeOut, status_code=201, dependencies=guarded)
def accept_invitation(
    body: AcceptIn, request: Request, response: Response, background: BackgroundTasks, db: DbDep
) -> MeOut:
    limit(request, "invitation")
    now = clock_of(request)()
    found = invitations.find_pending_by_token(db, body.token, now)
    if found is None:
        raise HTTPException(status_code=404, detail=INVALID_INVITATION)
    check_password(body.password)
    if owner_by_email(db, found.email) is not None:
        raise HTTPException(status_code=409, detail="That email already has an account")
    name = (body.display_name or "").strip() or None
    user = invitations.accept(
        db, found, now, password_hash=hash_password(body.password), display_name=name
    )
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That email already has an account") from None
    start_session(db, user, request, response)
    return me_out(db, user)


@router.post("/login", response_model=MeOut, dependencies=guarded)
def login(body: LoginIn, request: Request, response: Response, db: DbDep) -> MeOut:
    email = normalize_email(body.email)
    limit(request, "login", email)
    user = owner_by_email(db, email)
    if user is None or user.password_hash is None:
        burn_time(body.password)
        raise HTTPException(status_code=401, detail=WRONG_LOGIN)
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail=WRONG_LOGIN)
    # Only after the right password, so an unknown email learns nothing. start_session refuses
    # a disabled account.
    start_session(db, user, request, response)
    return me_out(db, user)


@router.post("/logout", status_code=204, response_model=None, dependencies=guarded)
def logout(request: Request, response: Response, db: DbDep) -> None:
    signed = find_session(db, request)
    if signed is not None:
        db.delete(signed.session)
        db.commit()
    clear_session_cookie(response, request)


@router.post("/password", status_code=204, response_model=None, dependencies=guarded)
def change_password(body: PasswordChangeIn, request: Request, signed: SignedDep, db: DbDep) -> None:
    user = signed.user
    limit(request, "password", user.email)
    if user.password_hash is not None and not verify_password(body.current, user.password_hash):
        raise HTTPException(status_code=400, detail=WRONG_CURRENT)
    check_password(body.new)
    user.password_hash = hash_password(body.new)
    end_sessions(db, user, keep=signed.session)
    db.commit()


@router.post("/forgot", response_model=MessageOut, dependencies=guarded)
def forgot(body: EmailIn, request: Request, background: BackgroundTasks, db: DbDep) -> MessageOut:
    email = normalize_email(body.email)
    limit(request, "forgot", email)
    user = owner_by_email(db, email)
    if user is not None:
        token = tokens.issue(db, "reset_password", user, clock_of(request)())
        db.commit()
        mail = Mail(
            to=user.email,
            subject="Reset your Learning Hub password",
            body=(
                "Open this link within 30 minutes to set a new password:\n\n"
                f"{link(request, 'reset', token)}\n\nIf you did not ask for this, "
                "ignore this message; your password stays the same.\n"
            ),
            purpose="reset-password",
        )
        queue_mail(request, background, mail)
    return MessageOut(message=FORGOT_SENT)


@router.post("/reset", response_model=MeOut, dependencies=guarded)
def reset(body: ResetIn, request: Request, response: Response, db: DbDep) -> MeOut:
    limit(request, "reset")
    # Checked first, so a short password does not use up the link.
    check_password(body.password)
    now = clock_of(request)()
    used = tokens.consume(db, "reset_password", body.token, now)
    user = db.get(User, used.user_id) if used and used.user_id else None
    if used is None or user is None or user.email != used.email:
        db.rollback()
        raise HTTPException(status_code=400, detail=INVALID_LINK)
    user.password_hash = hash_password(body.password)
    # The link reached the owner's mailbox, which proves the address.
    if user.email_verified_at is None:
        user.email_verified_at = now
    end_sessions(db, user)
    start_session(db, user, request, response)
    return me_out(db, user)


# --- magic link and email verification


@router.post("/magic", response_model=MessageOut, dependencies=guarded)
def magic(body: EmailIn, request: Request, background: BackgroundTasks, db: DbDep) -> MessageOut:
    email = normalize_email(body.email)
    limit(request, "magic", email)
    user = owner_by_email(db, email)
    if user is not None and user.email_verified_at is not None and user.disabled_at is None:
        token = tokens.issue(db, "magic_link", user, clock_of(request)())
        db.commit()
        mail = Mail(
            to=user.email,
            subject="Your Learning Hub sign-in link",
            body=(
                "Open this link within 15 minutes to sign in. It works once:\n\n"
                f"{link(request, 'magic', token)}\n\nIf you did not ask for this, "
                "ignore this message.\n"
            ),
            purpose="magic-link",
        )
        queue_mail(request, background, mail)
    return MessageOut(message=MAGIC_SENT)


@router.post("/magic/consume", response_model=MeOut, dependencies=guarded)
def magic_consume(body: TokenIn, request: Request, response: Response, db: DbDep) -> MeOut:
    limit(request, "magic-consume")
    used = tokens.consume(db, "magic_link", body.token, clock_of(request)())
    user = db.get(User, used.user_id) if used and used.user_id else None
    if used is None or user is None or user.email != used.email or user.email_verified_at is None:
        db.rollback()
        raise HTTPException(status_code=400, detail=INVALID_LINK)
    start_session(db, user, request, response)
    return me_out(db, user)


@router.post("/verify", response_model=VerifiedOut, dependencies=guarded)
def verify(body: TokenIn, request: Request, db: DbDep) -> VerifiedOut:
    limit(request, "verify")
    now = clock_of(request)()
    used = tokens.consume(db, "verify_email", body.token, now)
    user = db.get(User, used.user_id) if used and used.user_id else None
    if used is None or user is None or user.email != used.email:
        db.rollback()
        raise HTTPException(status_code=400, detail=INVALID_LINK)
    if user.email_verified_at is None:
        user.email_verified_at = now
    db.commit()
    return VerifiedOut(email_verified=True)


@router.post("/verify/resend", response_model=MessageOut, dependencies=guarded)
def verify_resend(
    request: Request, background: BackgroundTasks, signed: SignedDep, db: DbDep
) -> MessageOut:
    user = signed.user
    limit(request, "verify-resend", user.email)
    if user.email_verified_at is not None:
        return MessageOut(message=ALREADY_VERIFIED)
    token = tokens.issue(db, "verify_email", user, clock_of(request)())
    db.commit()
    queue_mail(request, background, verify_mail(request, user, token))
    return MessageOut(message=VERIFY_SENT)


# --- sessions


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(request: Request, signed: SignedDep, db: DbDep) -> list[SessionOut]:
    now = clock_of(request)()
    rows = db.scalars(
        select(UserSession)
        .where(UserSession.user_id == signed.user.id, UserSession.expires_at > now)
        .order_by(UserSession.last_seen_at.desc())
    ).all()
    return [
        SessionOut(
            id=row.id,
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
            expires_at=row.expires_at,
            user_agent=row.user_agent,
            ip=row.ip,
            current=row.id == signed.session.id,
        )
        for row in rows
    ]


@router.delete("/sessions/{session_id}", status_code=204, response_model=None, dependencies=guarded)
def revoke_session(
    session_id: UUID, request: Request, response: Response, signed: SignedDep, db: DbDep
) -> None:
    result = db.execute(
        delete(UserSession).where(
            UserSession.id == session_id, UserSession.user_id == signed.user.id
        )
    )
    if not getattr(result, "rowcount", 0):
        db.rollback()
        raise HTTPException(status_code=404, detail="session not found")
    db.commit()
    if session_id == signed.session.id:
        clear_session_cookie(response, request)


@router.post("/sessions/logout-others", response_model=RevokedOut, dependencies=guarded)
def logout_others(signed: SignedDep, db: DbDep) -> RevokedOut:
    revoked = end_sessions(db, signed.user, keep=signed.session)
    db.commit()
    return RevokedOut(revoked=revoked)


# --- GitHub and Google


def safe_next(value: str | None) -> str:
    """Only an in-app hash route; anything else (another site, odd characters) goes home."""
    if (
        value
        and value.startswith("#/")
        and len(value) <= 500
        and all(ch.isprintable() and ch not in "\\ " for ch in value)
    ):
        return value
    return "#/"


def app_url(settings: Settings, route: str) -> str:
    return f"{settings.public_url.rstrip('/')}/{route}"


def failed(settings: Settings, code: str) -> RedirectResponse:
    return RedirectResponse(app_url(settings, f"#/auth/login?error={code}"), status_code=302)


def user_for(db: Session, identity: Identity, request: Request) -> User:
    """Apply the sign-in rules to a verified provider identity (not committed).

    In order: a linked identity; the user with that verified email; a valid invitation for
    it (creates a member); the first account on the server (creates the admin); else refused.
    """
    now = clock_of(request)()
    account = db.scalar(
        select(OAuthAccount).where(
            OAuthAccount.provider == identity.provider,
            OAuthAccount.provider_user_id == identity.provider_user_id,
        )
    )
    user: User | None = None
    if account is not None:
        user = db.get(User, account.user_id)
        if user is None:
            raise OAuthError("not_invited")
    else:
        user = db.scalar(select(User).where(User.email == identity.email))
        if user is not None and user.email_verified_at is None:
            # An unverified account must not be taken over by whoever owns the email at GitHub.
            raise OAuthError("not_invited")
        if user is None:
            invitation = invitations.find_pending_by_email(db, identity.email, now)
            if invitation is not None:
                user = invitations.accept(db, invitation, now, display_name=identity.name)
            elif real_users(db) == 0:
                user = make_admin(
                    db, identity.email, now, display_name=identity.name, verified=True
                )
            else:
                raise OAuthError("not_invited")
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
                raise OAuthError("not_invited") from None
    if user.disabled_at is not None:
        raise OAuthError("account_disabled")
    if account is None:
        db.add(
            OAuthAccount(
                user_id=user.id,
                provider=identity.provider,
                provider_user_id=identity.provider_user_id,
                email=identity.email,
            )
        )
    return user


@router.get("/oauth/{provider}/start", response_model=None)
def oauth_start(
    provider: ProviderName,
    request: Request,
    db: DbDep,
    next: Annotated[str | None, Query()] = None,
) -> RedirectResponse:
    settings = settings_of(request)
    config = provider_config(settings, provider, db, box_of(request))
    if config is None:
        return failed(settings, "not_configured")
    store: PendingStore = request.app.state.oauth_pending
    key, pending = store.start(provider, safe_next(next))
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


@router.get("/oauth/{provider}/callback", response_model=None)
def oauth_callback(
    provider: ProviderName,
    request: Request,
    db: DbDep,
    code: Annotated[str | None, Query(max_length=2000)] = None,
    state: Annotated[str | None, Query(max_length=500)] = None,
    error: Annotated[str | None, Query(max_length=200)] = None,
) -> RedirectResponse:
    settings = settings_of(request)
    store: PendingStore = request.app.state.oauth_pending
    pending = store.take(request.cookies.get(PENDING_COOKIE))
    try:
        if (
            pending is None
            or pending.provider != provider
            or not state
            or not hmac.compare_digest(state.encode("utf-8"), pending.state.encode("utf-8"))
        ):
            raise OAuthError("state_mismatch")
        if error:
            raise OAuthError("access_denied")
        if not code:
            raise OAuthError("provider_error")
        config = provider_config(settings, provider, db, box_of(request))
        if config is None:
            raise OAuthError("not_configured")
        identity = fetch_identity(settings, config, code, pending.verifier)
        user = user_for(db, identity, request)
        token = create_session(db, user, request)
        db.commit()
        response = RedirectResponse(app_url(settings, pending.next), status_code=302)
        set_session_cookie(response, request, token)
    except OAuthError as problem:
        db.rollback()
        response = failed(settings, problem.code)
    response.delete_cookie(
        PENDING_COOKIE,
        path="/api/auth/oauth",
        httponly=True,
        samesite="lax",
        secure=is_secure(request, settings),
    )
    return response
