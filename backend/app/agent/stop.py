"""Stopping a running agent answer (change agent-stop).

The run row lives in the database, not in memory: on Vercel the user's Stop can reach another
instance than the one running the answer.
"""

import time
import uuid
from collections.abc import Callable
from datetime import timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.db import AgentRun

STOPPED_BY_USER = "Stopped by you."
# A row left by a request that died (killed function) is removed on the user's next run.
STALE_AFTER = timedelta(hours=1)

StopCheck = Callable[[], bool]


class RunInUse(Exception):
    """The run id is already used by a running request."""


def never_stop() -> bool:
    return False


def start_run(factory: sessionmaker[Session], user_id: uuid.UUID, run_id: uuid.UUID) -> None:
    """Record the run in its own transaction, so the request's session is not committed."""
    with factory() as db:
        db.execute(
            delete(AgentRun).where(
                AgentRun.user_id == user_id, AgentRun.started_at < func.now() - STALE_AFTER
            )
        )
        db.add(AgentRun(id=run_id, user_id=user_id))
        try:
            db.commit()
        except IntegrityError as exc:
            raise RunInUse from exc


def end_run(factory: sessionmaker[Session], run_id: uuid.UUID) -> None:
    with factory() as db:
        db.execute(delete(AgentRun).where(AgentRun.id == run_id))
        db.commit()


def request_stop(db: Session, user_id: uuid.UUID, run_id: uuid.UUID) -> None:
    """Mark the user's own running run; an unknown, ended or other user's run is left alone."""
    db.execute(
        update(AgentRun)
        .where(
            AgentRun.id == run_id,
            AgentRun.user_id == user_id,
            AgentRun.stop_requested_at.is_(None),
        )
        .values(stop_requested_at=func.now())
    )
    db.commit()


def stop_check(factory: sessionmaker[Session], run_id: uuid.UUID) -> StopCheck:
    """True once the user pressed Stop; read with its own short-lived session."""

    def check() -> bool:
        with factory() as db:
            asked = db.scalar(select(AgentRun.stop_requested_at).where(AgentRun.id == run_id))
        return asked is not None

    return check


def throttled(
    check: StopCheck, every: float = 1.0, clock: Callable[[], float] = time.monotonic
) -> StopCheck:
    """At most one real check per ``every`` seconds (a stream calls it for each line); once
    True, always True."""
    last = -every
    stopped = False

    def wrapper() -> bool:
        nonlocal last, stopped
        now = clock()
        if not stopped and now - last >= every:
            last = now
            stopped = check()
        return stopped

    return wrapper
