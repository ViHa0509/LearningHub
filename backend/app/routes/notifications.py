"""The signed-in user's notifications (change notifications): list, unread count, mark read."""

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth.current import CurrentUser
from app.db import Notification, get_session
from app.routes.guard import require_app_header

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

PAGE = 20
NOT_FOUND = "notification not found"
DbDep = Annotated[Session, Depends(get_session)]


class NotificationOut(BaseModel):
    id: uuid.UUID
    kind: str
    params: dict[str, Any]
    link: str
    created_at: datetime
    read_at: datetime | None


class CountOut(BaseModel):
    count: int


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    user: CurrentUser, db: DbDep, before: Annotated[datetime | None, Query()] = None
) -> list[Notification]:
    query = select(Notification).where(Notification.user_id == user.id)
    if before is not None:
        query = query.where(Notification.created_at < before)
    order = (Notification.created_at.desc(), Notification.id.desc())
    return list(db.scalars(query.order_by(*order).limit(PAGE)))


@router.get("/unread-count", response_model=CountOut)
def unread_count(user: CurrentUser, db: DbDep) -> CountOut:
    count = db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    return CountOut(count=count or 0)


@router.post("/read-all", response_model=CountOut, dependencies=[Depends(require_app_header)])
def read_all(user: CurrentUser, db: DbDep) -> CountOut:
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=func.now())
    )
    db.commit()
    return CountOut(count=0)


@router.post(
    "/{notification_id}/read",
    response_model=NotificationOut,
    dependencies=[Depends(require_app_header)],
)
def read_one(notification_id: uuid.UUID, user: CurrentUser, db: DbDep) -> Notification:
    row = db.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user.id
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    if row.read_at is None:
        row.read_at = func.now()
        db.commit()
        db.refresh(row)
    return row
