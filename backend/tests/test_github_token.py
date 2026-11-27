"""Spec: roadmap-explorer, "An optional GitHub token per user" (server side).

GitHub's rate_limit check and the roadmap.sh hosts are fakes; nothing here reaches the network.
The tokens are synthetic (format only)."""

import io
import logging
import zipfile
from typing import Any

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agent.messages import Turn
from app.agent.secrets import SecretBox
from app.agent.tools import AgentTools
from app.db import GithubToken
from tests.conftest import MEMBER_EMAIL, user_id_of
from tests.test_agent_chat import call, chat, use
from tests.test_data_backup import download
from tests.test_roadmapsh_tools import TREE, FakeHttp, default_answers, explorer, run

TOKEN = "fake_token_FIRSTVALUE0123456789wxyz"
OTHER = "fake_token_OTHERVALUE0123456789abcd"
RATE_LIMIT = "https://api.github.com/rate_limit"


class FakeGithub:
    """Accepts ``valid`` tokens (200), answers ``refused`` for others; records the calls."""

    def __init__(self, *valid: str, refused: int | None = 401) -> None:
        self.valid = set(valid)
        self.refused = refused
        self.calls: list[tuple[str, str]] = []

    def __call__(self, url: str, token: str) -> int | None:
        self.calls.append((url, token))
        return 200 if token in self.valid else self.refused


def app_of(client: TestClient) -> FastAPI:
    app: FastAPI = client.app  # type: ignore[assignment]
    return app


def fake_github(client: TestClient, *valid: str, refused: int | None = 401) -> FakeGithub:
    fake = FakeGithub(*valid, refused=refused)
    app_of(client).state.github_check = fake
    return fake


def rows(client: TestClient) -> list[GithubToken]:
    with app_of(client).state.session_factory() as db:
        return list(db.scalars(select(GithubToken)))


def tools_as(
    client: TestClient, session: Any, http: FakeHttp, settings_factory: Any, user: Any
) -> AgentTools:
    app = app_of(client)
    return AgentTools(
        session,
        app.state.catalog,
        user_id=user,
        roadmapsh=explorer(settings_factory, http),
        box=app.state.box,
    )


# Scenario: Save a token
def test_save_checks_the_token_and_the_status_shows_only_the_hint(client: TestClient) -> None:
    github = fake_github(client, TOKEN, OTHER)
    assert client.get("/api/github").json() == {"saved": False, "hint": None}
    saved = client.put("/api/github", json={"token": TOKEN})
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"saved": True, "hint": "…wxyz"}
    assert github.calls == [(RATE_LIMIT, TOKEN)]
    status = client.get("/api/github")
    assert status.json() == {"saved": True, "hint": "…wxyz"}
    assert TOKEN not in saved.text and TOKEN not in status.text
    [row] = rows(client)
    assert TOKEN not in row.token_enc
    assert app_of(client).state.box.decrypt(row.token_enc) == TOKEN
    # Replace keeps one row.
    assert client.put("/api/github", json={"token": OTHER}).json()["hint"] == "…abcd"
    [row] = rows(client)
    assert app_of(client).state.box.decrypt(row.token_enc) == OTHER


# Scenario: Token refused
def test_a_refused_token_is_not_saved(client: TestClient) -> None:
    fake_github(client)
    refused = client.put("/api/github", json={"token": TOKEN})
    assert refused.status_code == 400
    assert refused.json() == {"detail": "GitHub refused this token"}
    assert rows(client) == []


def test_a_refused_replacement_keeps_the_saved_token(client: TestClient) -> None:
    fake_github(client, TOKEN)
    client.put("/api/github", json={"token": TOKEN})
    assert client.put("/api/github", json={"token": OTHER}).status_code == 400
    [row] = rows(client)
    assert app_of(client).state.box.decrypt(row.token_enc) == TOKEN


@pytest.mark.parametrize("answer", [None, 403, 500])
def test_github_not_answering_is_502_and_saves_nothing(
    client: TestClient, answer: int | None
) -> None:
    fake_github(client, refused=answer)
    response = client.put("/api/github", json={"token": TOKEN})
    assert response.status_code == 502
    assert response.json() == {"detail": "GitHub did not answer"}
    assert rows(client) == []


def test_a_badly_formed_token_is_422_without_a_check_or_an_echo(client: TestClient) -> None:
    github = fake_github(client, TOKEN)
    for body in (
        {"token": "short_1234"},
        {"token": "has space FIRSTVALUE0123456789"},
        {"token": "x" * 256},
        {},
    ):
        response = client.put("/api/github", json=body)
        assert response.status_code == 422, body
        for value in body.values():
            assert value not in response.text
    assert github.calls == [] and rows(client) == []


# Scenario: Remove is confirmed first (server side: the removal)
def test_remove_deletes_the_token_and_answers_204_when_nothing_is_saved(
    client: TestClient,
) -> None:
    fake_github(client, TOKEN)
    assert client.delete("/api/github").status_code == 204
    client.put("/api/github", json={"token": TOKEN})
    removed = client.delete("/api/github")
    assert removed.status_code == 204 and removed.content == b""
    assert rows(client) == []
    assert client.get("/api/github").json() == {"saved": False, "hint": None}


# Scenario: Another user
def test_another_user_sees_and_removes_only_their_own(
    client: TestClient, second_client: TestClient
) -> None:
    fake_github(client, TOKEN, OTHER)
    client.put("/api/github", json={"token": TOKEN})
    assert second_client.get("/api/github").json() == {"saved": False, "hint": None}
    assert second_client.delete("/api/github").status_code == 204
    assert client.get("/api/github").json()["saved"] is True
    second_client.put("/api/github", json={"token": OTHER})
    assert client.get("/api/github").json()["hint"] == "…wxyz"
    assert second_client.get("/api/github").json()["hint"] == "…abcd"
    assert len(rows(client)) == 2


# Scenario: App header
def test_save_and_remove_need_the_app_header(client: TestClient) -> None:
    github = fake_github(client, TOKEN)
    no_header = {"X-LearningHub": ""}
    assert client.put("/api/github", json={"token": TOKEN}, headers=no_header).status_code == 403
    assert github.calls == [] and rows(client) == []
    client.put("/api/github", json={"token": TOKEN})
    assert client.delete("/api/github", headers=no_header).status_code == 403
    assert len(rows(client)) == 1


def test_the_routes_need_a_session(client: TestClient) -> None:
    with TestClient(app_of(client), headers={"X-LearningHub": "1"}) as anonymous:
        assert anonymous.get("/api/github").status_code == 401
        assert anonymous.put("/api/github", json={"token": TOKEN}).status_code == 401
        assert anonymous.delete("/api/github").status_code == 401


def test_no_log_line_holds_the_token(
    client: TestClient, settings_factory: Any, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    fake_github(client, TOKEN)
    client.put("/api/github", json={"token": OTHER})  # refused
    client.put("/api/github", json={"token": TOKEN})
    http = FakeHttp({TREE: 403})
    app_of(client).state.roadmapsh = explorer(settings_factory, http)
    use(client, Turn("", (call("roadmapsh_list"),)), Turn("No listing."))
    assert chat(client, "Which roadmaps are there?").status_code == 200
    client.get("/api/github")
    client.delete("/api/github")
    assert http.calls and caplog.records
    for secret in (TOKEN, OTHER, "FIRSTVALUE", "OTHERVALUE"):
        assert secret not in caplog.text


# Scenario: Tools send the token
def test_the_chat_tools_send_the_users_token(client: TestClient, settings_factory: Any) -> None:
    fake_github(client, TOKEN)
    client.put("/api/github", json={"token": TOKEN})
    http = FakeHttp(default_answers())
    app_of(client).state.roadmapsh = explorer(settings_factory, http)
    use(client, Turn("", (call("roadmapsh_list"),)), Turn("Closest: ai-engineer."))
    assert chat(client, "Roadmaps?").status_code == 200
    assert [(url, h.get("Authorization")) for url, h in http.calls] == [(TREE, f"Bearer {TOKEN}")]


def test_a_user_without_a_token_sends_none(
    client: TestClient, second_client: TestClient, settings_factory: Any
) -> None:
    fake_github(client, TOKEN)
    client.put("/api/github", json={"token": TOKEN})  # the admin's, not the member's
    member = user_id_of(app_of(client), MEMBER_EMAIL)
    http = FakeHttp(default_answers())
    with app_of(client).state.session_factory() as session:
        tools = tools_as(client, session, http, settings_factory, member)
        assert run(tools, "roadmapsh_list")["count"] == 2
    assert [h.get("Authorization") for _, h in http.calls] == [None]


def test_the_topic_tool_lists_with_the_token_and_fetches_the_file_without_it(
    client: TestClient, settings_factory: Any
) -> None:
    fake_github(client, TOKEN)
    client.put("/api/github", json={"token": TOKEN})
    http = FakeHttp(default_answers())
    with app_of(client).state.session_factory() as session:
        tools = tools_as(client, session, http, settings_factory, user_id_of(app_of(client)))
        data = run(tools, "roadmapsh_topic", slug="ai-engineer", node_id="n1")
    assert "AI Agents" in data["text"]
    assert [h.get("Authorization") for _, h in http.calls] == [f"Bearer {TOKEN}", None]


def test_an_undecryptable_token_is_ignored(client: TestClient, settings_factory: Any) -> None:
    owner = user_id_of(app_of(client))
    with app_of(client).state.session_factory() as db:
        other_box = SecretBox(Fernet.generate_key())
        db.add(GithubToken(user_id=owner, token_enc=other_box.encrypt(TOKEN), token_hint="…wxyz"))
        db.commit()
    http = FakeHttp(default_answers())
    with app_of(client).state.session_factory() as session:
        tools = tools_as(client, session, http, settings_factory, owner)
        assert run(tools, "roadmapsh_list")["count"] == 2
    assert [h.get("Authorization") for _, h in http.calls] == [None]


# Scenario: Not in the backup
def test_the_backup_holds_no_github_token_data(client: TestClient) -> None:
    fake_github(client, TOKEN)
    client.put("/api/github", json={"token": TOKEN})
    [row] = rows(client)
    archive = zipfile.ZipFile(io.BytesIO(download(client)))
    for name in archive.namelist():
        content = archive.read(name).decode("utf-8", errors="ignore")
        assert "github_token" not in name.lower() and "github_token" not in content, name
        for secret in (TOKEN, row.token_enc, "…wxyz", "FIRSTVALUE"):
            assert secret not in content, name
