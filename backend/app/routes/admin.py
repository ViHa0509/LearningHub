"""Admin routes: invitations and the Users page. Every route needs the admin (403 for members).

Nothing here logs or returns an invitation token; it only goes into the emailed link.
"""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import invitations
from app.auth.current import AdminUser
from app.auth.mail import Mail
from app.auth.schemas import Email
from app.auth.sessions import clock_of, end_sessions
from app.db import Invitation, Note, User, UserSession, get_session
from app.routes.auth import BAD_EMAIL, EMAIL_RE, link, normalize_email, queue_mail
from app.routes.guard import require_app_header
from app.storage import FileStore

router = APIRouter(prefix="/api/admin", tags=["admin"])
guarded = [Depends(require_app_header)]
DbDep = Annotated[Session, Depends(get_session)]

HAS_ACCOUNT = "That email already has an account"
OWN_DISABLE = "You cannot disable your own account"
OWN_DELETE = "You cannot delete your own account"
WRONG_CONFIRM = "Type the member's email to confirm"


class InviteIn(BaseModel):
    email: Email


class InvitationOut(BaseModel):
    id: UUID
    email: str
    created_at: datetime
    expires_at: datetime


class InvitationCreated(InvitationOut):
    # Only when no SMTP server is set up: the link cannot be emailed, so the admin gets it once.
    invite_url: str | None = None


class UserOut(BaseModel):
    id: UUID
    email: str
    display_name: str | None
    role: str
    created_at: datetime
    last_seen_at: datetime | None
    disabled: bool


class DisabledIn(BaseModel):
    disabled: bool


class DeleteIn(BaseModel):
    confirm_email: str = Field(max_length=320)


def invitation_out(row: Invitation) -> InvitationOut:
    return InvitationOut(
        id=row.id, email=row.email, created_at=row.created_at, expires_at=row.expires_at
    )


def user_out(db: Session, user: User) -> UserOut:
    seen = db.scalar(
        select(func.max(UserSession.last_seen_at)).where(UserSession.user_id == user.id)
    )
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        created_at=user.created_at,
        last_seen_at=seen,
        disabled=user.disabled_at is not None,
    )


def real_user(db: Session, user_id: UUID) -> User:
    user = db.get(User, user_id)
    if user is None or user.placeholder:
        raise HTTPException(status_code=404, detail="user not found")
    return user


# --- invitations


@router.post(
    "/invitations",
    response_model=InvitationCreated,
    response_model_exclude_none=True,
    status_code=201,
    dependencies=guarded,
)
def invite(
    body: InviteIn, request: Request, background: BackgroundTasks, admin: AdminUser, db: DbDep
) -> InvitationCreated:
    email = normalize_email(body.email)
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail=BAD_EMAIL)
    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise HTTPException(status_code=409, detail=HAS_ACCOUNT)
    invitation, token = invitations.issue(db, email, admin, clock_of(request)())
    db.commit()
    invite_link = link(request, "invite", token)
    mail = Mail(
        to=email,
        subject="You are invited to Learning Hub",
        body=(
            "You have been invited to join Learning Hub. Open this link within 7 days to "
            "create your account. It works once:\n\n"
            f"{invite_link}\n\nIf you did not expect this, ignore this "
            "message.\n"
        ),
        purpose="invitation",
    )
    queue_mail(request, background, mail)
    created = InvitationCreated(**invitation_out(invitation).model_dump())
    if request.app.state.mailer.mode == "outbox":
        created.invite_url = invite_link
    return created


@router.get("/invitations", response_model=list[InvitationOut])
def list_invitations(request: Request, admin: AdminUser, db: DbDep) -> list[InvitationOut]:
    now = clock_of(request)()
    rows = db.scalars(
        select(Invitation)
        .where(
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
            Invitation.expires_at > now,
        )
        .order_by(Invitation.created_at.desc())
    ).all()
    return [invitation_out(row) for row in rows]


@router.delete(
    "/invitations/{invitation_id}", status_code=204, response_model=None, dependencies=guarded
)
def revoke_invitation(invitation_id: UUID, request: Request, admin: AdminUser, db: DbDep) -> None:
    row = db.get(Invitation, invitation_id)
    if row is None or row.accepted_at is not None or row.revoked_at is not None:
        raise HTTPException(status_code=404, detail="invitation not found")
    row.revoked_at = clock_of(request)()
    db.commit()


# --- users


@router.get("/users", response_model=list[UserOut])
def list_users(admin: AdminUser, db: DbDep) -> list[UserOut]:
    users = db.scalars(
        select(User).where(User.placeholder.is_(False)).order_by(User.created_at, User.email)
    ).all()
    return [user_out(db, user) for user in users]


@router.put("/users/{user_id}/disabled", response_model=UserOut, dependencies=guarded)
def set_disabled(
    user_id: UUID, body: DisabledIn, request: Request, admin: AdminUser, db: DbDep
) -> UserOut:
    user = real_user(db, user_id)
    if user.id == admin.id:
        raise HTTPException(status_code=422, detail=OWN_DISABLE)
    if body.disabled:
        if user.disabled_at is None:
            user.disabled_at = clock_of(request)()
        end_sessions(db, user)
    else:
        user.disabled_at = None
    db.commit()
    return user_out(db, user)


@router.delete("/users/{user_id}", status_code=204, response_model=None, dependencies=guarded)
def delete_user(
    user_id: UUID, body: DeleteIn, request: Request, admin: AdminUser, db: DbDep
) -> None:
    user = real_user(db, user_id)
    if user.id == admin.id:
        raise HTTPException(status_code=422, detail=OWN_DELETE)
    if body.confirm_email.strip().lower() != user.email:
        raise HTTPException(status_code=422, detail=WRONG_CONFIRM)
    # Read before the cascade removes the rows.
    keys = set(db.scalars(select(Note.storage_key).where(Note.user_id == user.id)))
    db.delete(user)
    db.commit()
    store: FileStore = request.app.state.store
    for key in keys:
        left = db.scalar(select(func.count()).select_from(Note).where(Note.storage_key == key))
        if not left:
            store.delete(key)
