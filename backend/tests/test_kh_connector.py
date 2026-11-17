"""Spec: kh-connector - the connector is off until configured; connect with a device sign-in;
the sign-in is secret and the user's own; disconnect.

The identity service and Knowledge Hub are one fake HTTP function; nothing here touches the
network."""

import logging
import urllib.parse
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.auth.oauth import pkce_challenge
from app.auth.sessions import COOKIE
from app.config import Settings
from app.db import KhConnection
from app.kh.http import HttpReply, HttpRequest, KhNetworkError
from app.kh.service import KhReconnect, KhUnreachable
from app.main import create_app
from tests.conftest import (
    MEMBER_EMAIL,
    member_session_token,
    signed_in_client,
    user_id_of,
)

ISSUER = "https://idp.test/realms/kh"
KH = "https://kh.test"
CLIENT = "learning-hub-test"
IDP = f"{ISSUER}/protocol/openid-connect"

DEVICE_CODE = "DEVICE-CODE-SECRET-1"
USER_CODE = "ABCD-EFGH"
ACCESS = "ACCESS-TOKEN-SECRET-1"
REFRESH = "REFRESH-TOKEN-SECRET-1"
ROTATED = "REFRESH-TOKEN-SECRET-2"
SECRETS_TO_HIDE = (DEVICE_CODE, ACCESS, REFRESH, ROTATED)


@dataclass
class FakeKh:
    """The identity service and KH. ``token`` answers each device-grant poll in turn."""

    calls: list[HttpRequest] = field(default_factory=list)
    device_reply: HttpReply = field(
        default_factory=lambda: HttpReply(
            200,
            {
                "device_code": DEVICE_CODE,
                "user_code": USER_CODE,
                "verification_uri": f"{ISSUER}/device",
                "verification_uri_complete": f"{ISSUER}/device?user_code={USER_CODE}",
                "expires_in": 600,
                "interval": 5,
            },
        )
    )
    device_grant_reply: HttpReply = field(
        default_factory=lambda: HttpReply(400, {"error": "authorization_pending"})
    )
    refresh_reply: HttpReply = field(
        default_factory=lambda: HttpReply(
            200, {"access_token": ACCESS, "refresh_token": ROTATED, "expires_in": 300}
        )
    )
    me_reply: HttpReply = field(
        default_factory=lambda: HttpReply(
            200, {"email": "kh.user@example.test", "personal_project": "p-1", "role": "member"}
        )
    )
    revoke_reply: HttpReply = field(default_factory=lambda: HttpReply(200, None))
    search_reply: HttpReply = field(
        default_factory=lambda: HttpReply(200, {"status": "done", "text": "KH map"})
    )
    network_down: bool = False
    on_refresh: Callable[[HttpRequest], HttpReply | None] | None = None

    def approve(self) -> None:
        self.device_grant_reply = HttpReply(
            200, {"access_token": ACCESS, "refresh_token": REFRESH, "expires_in": 300}
        )

    def urls(self) -> list[str]:
        return [c.url for c in self.calls]

    def count(self, suffix: str) -> int:
        return sum(1 for c in self.calls if c.url.endswith(suffix))

    def __call__(self, request: HttpRequest) -> HttpReply:
        self.calls.append(request)
        if self.network_down:
            raise KhNetworkError("URLError")
        if request.url == f"{IDP}/auth/device":
            return self.device_reply
        if request.url == f"{IDP}/token":
            grant = (request.form or {}).get("grant_type")
            if grant == "refresh_token":
                hooked = self.on_refresh(request) if self.on_refresh else None
                return hooked or self.refresh_reply
            return self.device_grant_reply
        if request.url == f"{IDP}/revoke":
            return self.revoke_reply
        if request.url == f"{KH}/auth/me":
            return self.me_reply
        if request.url == f"{KH}/flows/task.full-retrieve/run":
            return self.search_reply
        raise AssertionError(f"unexpected call {request.url}")


@dataclass
class Kit:
    app: FastAPI
    client: TestClient
    fake: FakeKh
    now: list[datetime]

    def advance(self, seconds: int) -> None:
        self.now[0] = self.now[0] + timedelta(seconds=seconds)

    def row(self, user_id: Any = None) -> KhConnection | None:
        with self.app.state.session_factory() as db:
            uid = user_id or user_id_of(self.app)
            row = db.get(KhConnection, uid)
            if row is not None:
                db.expunge(row)
            return row

    def poll(self) -> Any:
        return self.client.post("/api/kh/connect/poll")

    def connect_and_approve(self) -> None:
        assert self.client.post("/api/kh/connect").status_code == 200
        self.fake.approve()
        response = self.poll()
        assert response.json()["status"] == "connected", response.text


@pytest.fixture
def kit(settings_factory: Callable[..., Settings]) -> Iterator[Kit]:
    settings = settings_factory(kh_url=KH, kh_issuer=ISSUER, kh_client_id=CLIENT)
    app = create_app(settings)
    fake = FakeKh()
    app.state.kh.http = fake
    now = [datetime.now(UTC)]
    app.state.clock = lambda: now[0]
    with signed_in_client(app, headers={"X-LearningHub": "1"}) as client:
        yield Kit(app, client, fake, now)
    app.state.engine.dispose()


# -- The connector is off until the server is configured ------------------------------------


def test_not_configured_status_says_so(client: TestClient) -> None:
    response = client.get("/api/kh")
    assert response.status_code == 200
    assert response.json() == {
        "available": False,
        "status": "disconnected",
        "email": None,
        "pending": None,
    }


def test_routes_when_not_configured_answer_404(client: TestClient) -> None:
    assert client.post("/api/kh/connect").status_code == 404
    assert client.post("/api/kh/connect/poll").status_code == 404
    assert client.delete("/api/kh").status_code == 404


@pytest.mark.parametrize("missing", ["kh_url", "kh_issuer", "kh_client_id"])
def test_all_three_settings_are_needed(
    settings_factory: Callable[..., Settings], missing: str
) -> None:
    values = {"kh_url": KH, "kh_issuer": ISSUER, "kh_client_id": CLIENT, missing: None}
    app = create_app(settings_factory(**values))
    with signed_in_client(app, headers={"X-LearningHub": "1"}) as client:
        assert client.get("/api/kh").json()["available"] is False
        assert client.post("/api/kh/connect").status_code == 404
    app.state.engine.dispose()


def test_configured_status_is_available_and_disconnected(kit: Kit) -> None:
    assert kit.client.get("/api/kh").json() == {
        "available": True,
        "status": "disconnected",
        "email": None,
        "pending": None,
    }


# -- Connect with a device sign-in ----------------------------------------------------------


def test_connect_starts_a_device_sign_in_with_pkce(kit: Kit) -> None:
    response = kit.client.post("/api/kh/connect")
    assert response.status_code == 200
    body = response.json()
    assert body["user_code"] == USER_CODE
    assert body["verification_uri"] == f"{ISSUER}/device"
    assert body["verification_uri_complete"] == f"{ISSUER}/device?user_code={USER_CODE}"
    assert body["interval"] == 5
    assert set(body) == {
        "verification_uri",
        "verification_uri_complete",
        "user_code",
        "interval",
        "expires_at",
    }
    assert DEVICE_CODE not in response.text
    form = kit.fake.calls[0].form or {}
    assert form["client_id"] == CLIENT
    assert form["scope"] == "openid offline_access"
    assert form["code_challenge_method"] == "S256"
    row = kit.row()
    assert row is not None and row.status == "pending"
    assert row.device_code_enc and DEVICE_CODE not in row.device_code_enc
    assert row.verifier_enc and row.refresh_token_enc is None
    box = kit.app.state.box
    assert box.decrypt(row.device_code_enc) == DEVICE_CODE
    assert pkce_challenge(box.decrypt(row.verifier_enc)) == form["code_challenge"]


def test_waiting_status_shows_the_pending_sign_in(kit: Kit) -> None:
    kit.client.post("/api/kh/connect")
    body = kit.client.get("/api/kh").json()
    assert body["status"] == "pending" and body["email"] is None
    assert body["pending"]["user_code"] == USER_CODE
    assert body["pending"]["verification_uri"] == f"{ISSUER}/device"
    assert body["pending"]["interval"] == 5
    assert body["pending"]["verification_uri_complete"] == f"{ISSUER}/device?user_code={USER_CODE}"
    assert DEVICE_CODE not in str(body)


def test_pending_past_expiry_reads_as_disconnected(kit: Kit) -> None:
    kit.client.post("/api/kh/connect")
    kit.advance(601)
    body = kit.client.get("/api/kh").json()
    assert body["status"] == "disconnected" and body["pending"] is None
    assert kit.row() is not None  # GET changes nothing


def test_poll_pending_then_connected(kit: Kit) -> None:
    kit.client.post("/api/kh/connect")
    first = kit.poll().json()
    assert first == {"status": "pending", "interval": 5, "email": None, "reason": None}
    kit.advance(5)
    kit.fake.approve()
    done = kit.poll().json()
    assert done == {
        "status": "connected",
        "interval": None,
        "email": "kh.user@example.test",
        "reason": None,
    }
    # The grant carried the device code and the verifier; /auth/me the access token.
    grant = next(
        c for c in kit.fake.calls if (c.form or {}).get("grant_type", "").startswith("urn")
    )
    assert grant.form and grant.form["device_code"] == DEVICE_CODE
    challenge = (kit.fake.calls[0].form or {})["code_challenge"]
    assert pkce_challenge(grant.form["code_verifier"]) == challenge
    me = next(c for c in kit.fake.calls if c.url == f"{KH}/auth/me")
    assert me.bearer == ACCESS
    # The row is connected: device fields cleared, refresh token encrypted, no access token.
    row = kit.row()
    assert row is not None and row.status == "connected"
    assert row.kh_email == "kh.user@example.test" and row.personal_project == "p-1"
    assert row.connected_at is not None
    assert row.device_code_enc is None and row.verifier_enc is None and row.user_code is None
    assert row.verification_uri is None and row.verification_uri_complete is None
    assert row.interval is None and row.expires_at is None
    assert row.refresh_token_enc and REFRESH not in row.refresh_token_enc
    assert kit.app.state.box.decrypt(row.refresh_token_enc) == REFRESH
    with kit.app.state.session_factory() as db:
        dumped = str(db.execute(text("SELECT * FROM kh_connections")).all())
    assert ACCESS not in dumped and REFRESH not in dumped and DEVICE_CODE not in dumped
    assert kit.client.get("/api/kh").json() == {
        "available": True,
        "status": "connected",
        "email": "kh.user@example.test",
        "pending": None,
    }


def test_poll_on_a_connected_row_answers_connected(kit: Kit) -> None:
    kit.connect_and_approve()
    calls = len(kit.fake.calls)
    again = kit.poll().json()
    assert again["status"] == "connected" and again["email"] == "kh.user@example.test"
    assert len(kit.fake.calls) == calls


def test_poll_without_a_sign_in_is_404(kit: Kit) -> None:
    assert kit.poll().status_code == 404


def test_checking_too_often_does_not_call_the_identity_service(kit: Kit) -> None:
    kit.client.post("/api/kh/connect")
    kit.poll()
    grants = kit.fake.count("/token")
    kit.advance(2)  # less than the interval of 5
    again = kit.poll().json()
    assert again["status"] == "pending" and again["interval"] == 5
    assert kit.fake.count("/token") == grants
    kit.advance(3)
    kit.poll()
    assert kit.fake.count("/token") == grants + 1


def test_slow_down_raises_the_interval_by_five(kit: Kit) -> None:
    kit.client.post("/api/kh/connect")
    kit.fake.device_grant_reply = HttpReply(400, {"error": "slow_down"})
    assert kit.poll().json()["interval"] == 10
    assert kit.client.get("/api/kh").json()["pending"]["interval"] == 10
    kit.advance(5)  # the old interval is no longer enough
    grants = kit.fake.count("/token")
    assert kit.poll().json()["status"] == "pending"
    assert kit.fake.count("/token") == grants
    kit.advance(5)
    kit.fake.device_grant_reply = HttpReply(400, {"error": "authorization_pending"})
    assert kit.poll().json()["interval"] == 10
    assert kit.fake.count("/token") == grants + 1


def test_identity_service_not_answering_a_poll_stays_pending(kit: Kit) -> None:
    kit.client.post("/api/kh/connect")
    kit.fake.network_down = True
    answer = kit.poll().json()
    assert answer["status"] == "pending" and answer["interval"] == 5
    assert kit.row() is not None


def test_user_refuses_on_the_sign_in_page(kit: Kit) -> None:
    kit.client.post("/api/kh/connect")
    kit.fake.device_grant_reply = HttpReply(400, {"error": "access_denied"})
    answer = kit.poll().json()
    assert answer["status"] == "denied" and answer["reason"]
    assert answer["email"] is None and answer["interval"] is None
    assert kit.row() is None
    assert kit.poll().status_code == 404


def test_kh_does_not_know_the_account(kit: Kit) -> None:
    kit.client.post("/api/kh/connect")
    kit.fake.approve()
    kit.fake.me_reply = HttpReply(
        403, {"detail": "This account is not registered in Knowledge Hub"}
    )
    answer = kit.poll().json()
    assert answer["status"] == "denied"
    assert answer["reason"] == "This account is not registered in Knowledge Hub"
    assert kit.row() is None
    assert kit.fake.count("/revoke") == 1  # the sign-in just made is not kept
    assert (kit.fake.calls[-1].form or {})["token"] == REFRESH


def test_code_expired_at_the_identity_service(kit: Kit) -> None:
    kit.client.post("/api/kh/connect")
    kit.fake.device_grant_reply = HttpReply(400, {"error": "expired_token"})
    answer = kit.poll().json()
    assert answer["status"] == "expired" and answer["reason"]
    assert kit.row() is None


def test_code_expired_by_the_clock_does_not_call_the_identity_service(kit: Kit) -> None:
    kit.client.post("/api/kh/connect")
    kit.advance(601)
    grants = kit.fake.count("/token")
    answer = kit.poll().json()
    assert answer["status"] == "expired"
    assert kit.fake.count("/token") == grants
    assert kit.row() is None


def test_any_other_identity_error_is_denied_with_its_reason(kit: Kit) -> None:
    kit.client.post("/api/kh/connect")
    kit.fake.device_grant_reply = HttpReply(
        400, {"error": "invalid_client", "error_description": "Client not allowed"}
    )
    answer = kit.poll().json()
    assert answer["status"] == "denied" and answer["reason"] == "Client not allowed"
    assert kit.row() is None


def test_connect_when_connected_is_a_conflict(kit: Kit) -> None:
    kit.connect_and_approve()
    calls = len(kit.fake.calls)
    response = kit.client.post("/api/kh/connect")
    assert response.status_code == 409
    assert "disconnect" in response.json()["detail"].lower()
    assert len(kit.fake.calls) == calls
    row = kit.row()
    assert row is not None and row.status == "connected"


def test_a_second_connect_replaces_the_pending_sign_in(kit: Kit) -> None:
    kit.client.post("/api/kh/connect")
    kit.fake.device_reply = HttpReply(
        200,
        {
            "device_code": "OTHER-DEVICE-CODE",
            "user_code": "WXYZ-1234",
            "verification_uri": f"{ISSUER}/device",
            "expires_in": 300,
        },
    )
    body = kit.client.post("/api/kh/connect").json()
    assert body["user_code"] == "WXYZ-1234"
    assert body["interval"] == 5 and body["verification_uri_complete"] is None
    row = kit.row()
    assert row is not None
    assert kit.app.state.box.decrypt(row.device_code_enc or "") == "OTHER-DEVICE-CODE"
    assert row.last_poll_at is None


def test_connect_when_the_identity_service_fails_is_502_and_leaves_no_row(kit: Kit) -> None:
    kit.fake.device_reply = HttpReply(500, None)
    response = kit.client.post("/api/kh/connect")
    assert response.status_code == 502
    assert response.json() == {"detail": "Knowledge Hub sign-in did not answer"}
    assert kit.row() is None
    kit.fake.network_down = True
    assert kit.client.post("/api/kh/connect").status_code == 502
    assert kit.row() is None


@pytest.mark.parametrize(
    "patch",
    [
        {"verification_uri": "javascript:alert(1)"},
        {"verification_uri": "ftp://idp.test/device"},
        {"verification_uri_complete": "javascript:alert(1)"},
        {"verification_uri_complete": 5},
    ],
)
def test_connect_refuses_a_device_answer_with_a_non_web_link(
    kit: Kit, patch: dict[str, Any]
) -> None:
    body = dict(kit.fake.device_reply.body)
    body.update(patch)
    kit.fake.device_reply = HttpReply(200, body)
    response = kit.client.post("/api/kh/connect")
    assert response.status_code == 502
    assert kit.row() is None


def test_cancel_while_waiting_keeps_no_connection(kit: Kit) -> None:
    kit.client.post("/api/kh/connect")
    assert kit.client.delete("/api/kh").status_code == 204
    assert kit.row() is None
    assert kit.fake.count("/revoke") == 0
    assert kit.client.get("/api/kh").json()["status"] == "disconnected"


def test_delete_without_a_row_is_204(kit: Kit) -> None:
    assert kit.client.delete("/api/kh").status_code == 204


# -- The KH sign-in is secret and the user's own --------------------------------------------


def test_status_holds_no_secret(kit: Kit) -> None:
    kit.connect_and_approve()
    text_ = kit.client.get("/api/kh").text
    for secret in SECRETS_TO_HIDE:
        assert secret not in text_
    assert "verifier" not in text_ and "token" not in text_


def test_another_user_is_not_connected_and_cannot_touch_it(kit: Kit) -> None:
    kit.connect_and_approve()
    with TestClient(
        kit.app,
        headers={"X-LearningHub": "1"},
        cookies={COOKIE: member_session_token(kit.app)},
    ) as other:
        assert other.get("/api/kh").json() == {
            "available": True,
            "status": "disconnected",
            "email": None,
            "pending": None,
        }
        assert other.post("/api/kh/connect/poll").status_code == 404
        assert other.delete("/api/kh").status_code == 204  # nothing of A's is removed
        pending = other.post("/api/kh/connect")  # B's own sign-in, not a conflict with A's
        assert pending.status_code == 200
    mine = kit.row()
    assert mine is not None and mine.status == "connected"
    theirs = kit.row(user_id_of(kit.app, MEMBER_EMAIL))
    assert theirs is not None and theirs.status == "pending"
    assert kit.client.get("/api/kh").json()["email"] == "kh.user@example.test"


@pytest.mark.parametrize(
    ("method", "path"),
    [("POST", "/api/kh/connect"), ("POST", "/api/kh/connect/poll"), ("DELETE", "/api/kh")],
)
def test_mutating_calls_need_the_app_header(kit: Kit, method: str, path: str) -> None:
    kit.client.post("/api/kh/connect")
    calls = len(kit.fake.calls)
    response = kit.client.request(method, path, headers={"X-LearningHub": ""})
    assert response.status_code == 403
    assert len(kit.fake.calls) == calls
    assert kit.row() is not None


def test_routes_need_a_session(kit: Kit) -> None:
    with TestClient(kit.app, headers={"X-LearningHub": "1"}) as anonymous:
        assert anonymous.get("/api/kh").status_code == 401
        assert anonymous.post("/api/kh/connect").status_code == 401
        assert anonymous.post("/api/kh/connect/poll").status_code == 401
        assert anonymous.delete("/api/kh").status_code == 401


def test_no_token_or_code_reaches_the_log(kit: Kit, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    kit.client.post("/api/kh/connect")
    kit.fake.approve()
    kit.poll()
    kit.fake.network_down = True
    kit.client.post("/api/kh/connect")  # refused: connected
    kit.fake.network_down = False
    kit.app.state.kh.access_token(user_id_of(kit.app))
    kit.fake.refresh_reply = HttpReply(400, {"error": "invalid_grant"})
    with pytest.raises(KhReconnect):
        kit.app.state.kh.access_token(user_id_of(kit.app))
    kit.client.post("/api/kh/connect")
    kit.fake.network_down = True
    kit.poll()
    kit.client.delete("/api/kh")
    assert "kh " in caplog.text  # the calls were logged ...
    for secret in (*SECRETS_TO_HIDE, USER_CODE):  # ... without any secret
        assert secret not in caplog.text


# -- Tokens: refresh with rotation ----------------------------------------------------------


def test_access_token_exchanges_the_refresh_token_and_saves_the_rotated_one(kit: Kit) -> None:
    kit.connect_and_approve()
    uid = user_id_of(kit.app)
    assert kit.app.state.kh.access_token(uid) == ACCESS
    form = kit.fake.calls[-1].form or {}
    assert form == {"grant_type": "refresh_token", "refresh_token": REFRESH, "client_id": CLIENT}
    row = kit.row()
    assert row is not None and row.refresh_token_enc
    assert kit.app.state.box.decrypt(row.refresh_token_enc) == ROTATED
    kit.app.state.kh.access_token(uid)
    assert (kit.fake.calls[-1].form or {})["refresh_token"] == ROTATED


def test_rotated_token_is_not_saved_over_a_newer_one(kit: Kit) -> None:
    kit.connect_and_approve()
    uid = user_id_of(kit.app)
    newer = kit.app.state.box.encrypt("NEWER-REFRESH")

    def other_call_rotated(_: HttpRequest) -> None:
        with kit.app.state.session_factory() as db:
            db.execute(text("UPDATE kh_connections SET refresh_token_enc = :t"), {"t": newer})
            db.commit()

    kit.fake.on_refresh = other_call_rotated
    kit.app.state.kh.access_token(uid)
    row = kit.row()
    assert row is not None and row.refresh_token_enc == newer


def test_a_refused_token_whose_row_changed_is_retried_once_and_the_row_stays(kit: Kit) -> None:
    kit.connect_and_approve()
    uid = user_id_of(kit.app)
    newer = kit.app.state.box.encrypt("NEWER-REFRESH")
    sent: list[str] = []

    def reply(request: HttpRequest) -> HttpReply | None:
        token = (request.form or {})["refresh_token"]
        sent.append(token)
        if token == REFRESH:  # the first call is refused after another call rotated the token
            with kit.app.state.session_factory() as db:
                db.execute(text("UPDATE kh_connections SET refresh_token_enc = :t"), {"t": newer})
                db.commit()
            return HttpReply(400, {"error": "invalid_grant"})
        return HttpReply(200, {"access_token": ACCESS})

    kit.fake.on_refresh = reply
    assert kit.app.state.kh.access_token(uid) == ACCESS
    assert sent == [REFRESH, "NEWER-REFRESH"]
    row = kit.row()
    assert row is not None and row.refresh_token_enc == newer


def test_a_refused_token_is_retried_only_once(kit: Kit) -> None:
    kit.connect_and_approve()
    uid = user_id_of(kit.app)
    sent: list[str] = []

    def reply(request: HttpRequest) -> HttpReply | None:
        sent.append((request.form or {})["refresh_token"])
        with kit.app.state.session_factory() as db:
            db.execute(
                text("UPDATE kh_connections SET refresh_token_enc = :t"),
                {"t": kit.app.state.box.encrypt(f"T{len(sent)}")},
            )
            db.commit()
        return HttpReply(400, {"error": "invalid_grant"})

    kit.fake.on_refresh = reply
    with pytest.raises(KhReconnect):
        kit.app.state.kh.access_token(uid)
    assert len(sent) == 2
    assert kit.row() is not None  # the stored token is not the refused one


def test_access_token_without_rotation_keeps_the_token(kit: Kit) -> None:
    kit.connect_and_approve()
    kit.fake.refresh_reply = HttpReply(200, {"access_token": ACCESS})
    kit.app.state.kh.access_token(user_id_of(kit.app))
    row = kit.row()
    assert row is not None and kit.app.state.box.decrypt(row.refresh_token_enc or "") == REFRESH


def test_a_refused_refresh_token_removes_the_connection(kit: Kit) -> None:
    kit.connect_and_approve()
    kit.fake.refresh_reply = HttpReply(400, {"error": "invalid_grant"})
    with pytest.raises(KhReconnect):
        kit.app.state.kh.access_token(user_id_of(kit.app))
    assert kit.row() is None
    assert kit.client.get("/api/kh").json()["status"] == "disconnected"


def test_refresh_when_the_identity_service_is_down_keeps_the_connection(kit: Kit) -> None:
    kit.connect_and_approve()
    kit.fake.network_down = True
    with pytest.raises(KhUnreachable):
        kit.app.state.kh.access_token(user_id_of(kit.app))
    assert kit.row() is not None


def test_access_token_without_a_connection_needs_a_reconnect(kit: Kit) -> None:
    with pytest.raises(KhReconnect):
        kit.app.state.kh.access_token(user_id_of(kit.app))


# -- Disconnect -----------------------------------------------------------------------------


def test_disconnect_revokes_and_removes_the_connection(kit: Kit) -> None:
    kit.connect_and_approve()
    assert kit.client.delete("/api/kh").status_code == 204
    revoke = kit.fake.calls[-1]
    assert revoke.url == f"{IDP}/revoke"
    assert revoke.form == {
        "client_id": CLIENT,
        "token": REFRESH,
        "token_type_hint": "refresh_token",
    }
    assert kit.row() is None
    assert kit.client.get("/api/kh").json()["status"] == "disconnected"


def test_disconnect_still_removes_the_row_when_revoke_fails(kit: Kit) -> None:
    kit.connect_and_approve()
    kit.fake.network_down = True
    assert kit.client.delete("/api/kh").status_code == 204
    assert kit.row() is None


def test_rows_are_removed_with_their_user(kit: Kit) -> None:
    kit.connect_and_approve()
    with kit.app.state.session_factory() as db:
        db.execute(text("DELETE FROM users"))
        db.commit()
        assert db.scalars(select(KhConnection)).all() == []


def test_urllib_http_refuses_other_schemes() -> None:
    from app.kh.http import urllib_http

    with pytest.raises(KhNetworkError):
        urllib_http(HttpRequest("GET", "file:///etc/passwd"))
    assert urllib.parse.urlparse(ISSUER).scheme == "https"
