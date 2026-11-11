"""Who is asking: the signed-in user, the admin check, and the admin when the login is off."""

from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.sessions import require_signed
from app.config import Settings
from app.db import User, get_session

PLACEHOLDER_EMAIL = "admin@localhost.invalid"
ADMIN_ONLY = "Only the admin can do this"

DbDep = Annotated[Session, Depends(get_session)]


def find_admin(db: Session) -> User | None:
    return db.scalar(select(User).where(User.role == "admin"))


def ensure_admin(db: Session) -> User:
    """The admin; a no-login placeholder admin is created (and committed) when there is none."""
    admin = find_admin(db)
    if admin is not None:
        return admin
    db.add(User(email=PLACEHOLDER_EMAIL, role="admin", placeholder=True, preferences={}))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # another request created it first
    admin = find_admin(db)
    if admin is None:
        raise HTTPException(status_code=500, detail="could not create the admin account")
    return admin


def current_user(request: Request, response: Response, db: DbDep) -> User:
    """The signed-in user (401 when signed out or disabled); the admin when the login is off."""
    settings: Settings = request.app.state.settings
    if not settings.auth_required:
        return ensure_admin(db)
    return require_signed(request, response, db).user


def require_admin(user: Annotated[User, Depends(current_user)]) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail=ADMIN_ONLY)
    return user


CurrentUser = Annotated[User, Depends(current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
