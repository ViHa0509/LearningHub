"""Spec: auth - Set up GitHub and Google sign-in in the app."""

from collections.abc import Callable

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.config import Settings
from app.main import create_app
from tests.conftest import TEST_DATABASE_URL, signed_in_client

URL = "/api/settings/sign-in"
SECRET = "super-secret-value-1234"


def raw_row(key: str) -> tuple[str, str | None] | None:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT value::text, secret_enc FROM app_settings WHERE key = :k"), {"k": key}
        ).first()
    engine.dispose()
    return None if row is None else (row[0], row[1])


def save(client: TestClient, provider: str = "github", **body: str) -> object:
    payload = {"client_id": "my-client-id", "client_secret": SECRET, **body}
    return client.put(f"{URL}/{provider}", json=payload)


def test_save_turns_github_on_without_restart(client: TestClient) -> None:
    assert client.get("/api/auth/status").json()["providers"]["github"]["configured"] is False
    response = save(client)
    assert response.status_code == 200  # type: ignore[attr-defined]
    github = response.json()["providers"]["github"]  # type: ignore[attr-defined]
    assert github["client_id"] == "my-client-id"
    assert github["source"] == "app"
    assert github["secret_hint"] == "…1234"
    assert client.get("/api/auth/status").json()["providers"]["github"]["configured"] is True
    start = client.get("/api/auth/oauth/github/start", follow_redirects=False)
    assert start.status_code == 302
    assert "client_id=my-client-id" in start.headers["location"]
    stored = raw_row("oauth.github")
    assert stored is not None and stored[1] is not None and SECRET not in stored[1]


def test_callback_url_uses_public_url(settings_factory: Callable[..., Settings]) -> None:
    app = create_app(settings_factory(public_url="https://hub.example.com/"))
    with signed_in_client(app, headers={"X-LearningHub": "1"}) as client:
        body = client.get(URL).json()
    app.state.engine.dispose()
    assert body["public_url"] == "https://hub.example.com"
    github = body["providers"]["github"]["callback_url"]
    assert github == "https://hub.example.com/api/auth/oauth/github/callback"
    google = body["providers"]["google"]["callback_url"]
    assert google == "https://hub.example.com/api/auth/oauth/google/callback"


def test_remove_provider(client: TestClient) -> None:
    save(client, "google")
    assert client.get("/api/auth/status").json()["providers"]["google"]["configured"] is True
    assert client.delete(f"{URL}/google").status_code == 204
    assert client.get("/api/auth/status").json()["providers"]["google"]["configured"] is False
    body = client.get(URL).json()["providers"]["google"]
    assert body["source"] is None and body["client_id"] is None
    assert raw_row("oauth.google") is None


def test_remove_falls_back_to_environment(settings_factory: Callable[..., Settings]) -> None:
    from pydantic import SecretStr

    app = create_app(
        settings_factory(github_client_id="env-id", github_client_secret=SecretStr("env-secret-9"))
    )
    with signed_in_client(app, headers={"X-LearningHub": "1"}) as client:
        assert client.get(URL).json()["providers"]["github"]["source"] == "env"
        save(client)
        assert client.get(URL).json()["providers"]["github"]["source"] == "app"
        client.delete(f"{URL}/github")
        github = client.get(URL).json()["providers"]["github"]
        assert github["source"] == "env" and github["client_id"] == "env-id"
        assert "env-secret-9" not in client.get(URL).text
    app.state.engine.dispose()


def test_secret_never_returned(client: TestClient) -> None:
    save(client)
    for response in (client.get(URL), save(client, client_secret="")):
        assert SECRET not in response.text  # type: ignore[attr-defined]
    assert client.get(URL).json()["providers"]["github"]["secret_hint"] == "…1234"


def test_put_without_secret_keeps_old_one(client: TestClient) -> None:
    save(client)
    before = raw_row("oauth.github")
    response = client.put(f"{URL}/github", json={"client_id": "other-id"})
    assert response.status_code == 200
    after = raw_row("oauth.github")
    assert before is not None and after is not None
    assert after[1] == before[1]
    assert response.json()["providers"]["github"]["client_id"] == "other-id"


def test_put_without_secret_and_none_stored_is_422(client: TestClient) -> None:
    assert client.put(f"{URL}/github", json={"client_id": "x"}).status_code == 422
    assert raw_row("oauth.github") is None


def test_invalid_values_are_422(client: TestClient) -> None:
    assert save(client, client_id="  ").status_code == 422  # type: ignore[attr-defined]
    assert save(client, client_id="x" * 201).status_code == 422  # type: ignore[attr-defined]
    assert save(client, client_secret="x" * 201).status_code == 422  # type: ignore[attr-defined]


def test_unknown_provider_is_404(client: TestClient) -> None:
    assert save(client, "gitlab").status_code == 404  # type: ignore[attr-defined]
    assert client.delete(f"{URL}/gitlab").status_code == 404


def test_writes_need_app_header(client: TestClient) -> None:
    body = {"client_id": "a", "client_secret": "b"}
    assert client.put(f"{URL}/github", json=body, headers={"X-LearningHub": "0"}).status_code == 403
    assert client.delete(f"{URL}/github", headers={"X-LearningHub": "0"}).status_code == 403
    assert raw_row("oauth.github") is None


def test_only_the_owner(settings_factory: Callable[..., Settings]) -> None:
    app = create_app(settings_factory())
    with TestClient(app, headers={"X-LearningHub": "1"}) as anonymous:
        assert anonymous.get(URL).status_code == 401
        assert save(anonymous).status_code == 401  # type: ignore[attr-defined]
        assert anonymous.delete(f"{URL}/github").status_code == 401
    app.state.engine.dispose()
    assert raw_row("oauth.github") is None
