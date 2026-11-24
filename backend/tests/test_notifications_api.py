"""Spec: notifications - Bell and list (server side), Notifications are private and safe."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db import Notification
from app.notifications import notify
from tests.conftest import user_id_of


def _db(client: TestClient) -> Session:
    session: Session = client.app.state.session_factory()  # type: ignore[attr-defined]
    return session


def _make(client: TestClient, count: int, email: str | None = None) -> None:
    user = user_id_of(client.app, email)  # type: ignore[arg-type]
    with _db(client) as db:
        for n in range(count):
            notify(db, user, "restored", {"notes": n, "lessons": 0}, "#/")
        db.commit()


def test_unread_count_and_mark_all_read(client: TestClient) -> None:
    _make(client, 3)
    assert client.get("/api/notifications/unread-count").json() == {"count": 3}
    assert client.post("/api/notifications/read-all").json() == {"count": 0}
    assert client.get("/api/notifications/unread-count").json() == {"count": 0}
    assert all(n["read_at"] for n in client.get("/api/notifications").json())


def test_list_is_newest_first_and_paged_by_twenty(client: TestClient) -> None:
    _make(client, 25)
    user = user_id_of(client.app)
    with _db(client) as db:
        for n, row in enumerate(db.query(Notification).filter_by(user_id=user).all()):
            row.created_at = datetime.now(UTC) - timedelta(minutes=n)
        db.commit()
    first = client.get("/api/notifications").json()
    assert len(first) == 20
    stamps = [n["created_at"] for n in first]
    assert stamps == sorted(stamps, reverse=True)
    assert set(first[0]) == {"id", "kind", "params", "link", "created_at", "read_at"}
    rest = client.get("/api/notifications", params={"before": first[-1]["created_at"]}).json()
    assert len(rest) == 5
    assert {n["id"] for n in rest}.isdisjoint(n["id"] for n in first)


def test_mark_one_read(client: TestClient) -> None:
    _make(client, 2)
    first = client.get("/api/notifications").json()[0]
    assert first["read_at"] is None
    done = client.post(f"/api/notifications/{first['id']}/read")
    assert done.status_code == 200 and done.json()["read_at"]
    assert client.get("/api/notifications/unread-count").json() == {"count": 1}


def test_another_users_notification_is_404_and_stays_unread(
    client: TestClient, second_client: TestClient
) -> None:
    _make(client, 2)
    mine = client.get("/api/notifications").json()
    assert second_client.get("/api/notifications").json() == []
    assert second_client.get("/api/notifications/unread-count").json() == {"count": 0}
    assert second_client.post(f"/api/notifications/{mine[0]['id']}/read").status_code == 404
    assert second_client.post(f"/api/notifications/{uuid4()}/read").status_code == 404
    assert second_client.post("/api/notifications/read-all").json() == {"count": 0}
    assert client.get("/api/notifications/unread-count").json() == {"count": 2}


def test_mutating_routes_need_the_app_header(client: TestClient) -> None:
    _make(client, 1)
    nid = client.get("/api/notifications").json()[0]["id"]
    bare = {"X-LearningHub": ""}
    assert client.post(f"/api/notifications/{nid}/read", headers=bare).status_code == 403
    assert client.post("/api/notifications/read-all", headers=bare).status_code == 403
    assert client.get("/api/notifications/unread-count").json() == {"count": 1}


def test_routes_need_a_session(client: TestClient) -> None:
    client.cookies.clear()
    assert client.get("/api/notifications").status_code == 401
    assert client.get("/api/notifications/unread-count").status_code == 401


def test_markup_in_params_is_returned_as_plain_data(client: TestClient) -> None:
    user = user_id_of(client.app)
    with _db(client) as db:
        notify(db, user, "new_member", {"name": "<img src=x onerror=alert(1)>"}, "#/")
        db.execute(update(Notification).values(read_at=None))
        db.commit()
    (item,) = client.get("/api/notifications").json()
    assert item["params"]["name"] == "<img src=x onerror=alert(1)>"
