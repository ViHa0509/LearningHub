"""Spec: delivery - Run a released version, Public access through a tunnel."""

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import PublicWithoutLogin, create_app


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text("<!doctype html><title>Learning Hub</title>", "utf-8")
    (root / "assets" / "app.js").write_text("console.log('app')", "utf-8")
    (tmp_path / "secret.txt").write_text("outside", "utf-8")
    return root


# Scenario: Serve the app
def test_serves_the_app_page_and_keeps_the_api(
    settings_factory: Callable[..., Settings], dist: Path
) -> None:
    settings: Any = settings_factory(static_dir=dist)
    with TestClient(create_app(settings)) as client:
        page = client.get("/")
        assert page.status_code == 200
        assert "<title>Learning Hub</title>" in page.text
        assert client.get("/assets/app.js").text == "console.log('app')"
        # Any other non-API path is the app page (the app routes by hash, but deep links work).
        assert "Learning Hub" in client.get("/some/page").text
        assert client.get("/api/health").json() == {"status": "ok"}
        # Unknown API paths stay 404, and data routes still need a session.
        assert client.get("/api/nothing-here").status_code == 404
        assert client.get("/api/notes").status_code == 401


def test_never_serves_a_file_outside_the_folder(
    settings_factory: Callable[..., Settings], dist: Path
) -> None:
    settings: Any = settings_factory(static_dir=dist)
    with TestClient(create_app(settings)) as client:
        for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"):
            assert "outside" not in client.get(path).text


# Scenario: Without a static folder
def test_without_a_static_folder_the_root_is_404(client: TestClient) -> None:
    assert client.get("/").status_code == 404


# Scenario: Public without login
def test_refuses_a_public_address_without_the_login(
    settings_factory: Callable[..., Settings],
) -> None:
    settings: Any = settings_factory(public_url="https://hub.example.com", auth_required=False)
    with pytest.raises(PublicWithoutLogin, match="login must be on"):
        create_app(settings)


# Scenario: Public with login
def test_public_with_login_starts_and_answers_401_without_a_session(
    settings_factory: Callable[..., Settings],
) -> None:
    settings: Any = settings_factory(public_url="https://hub.example.com")
    with TestClient(create_app(settings), base_url="https://hub.example.com") as client:
        assert client.get("/api/notes").status_code == 401
        assert client.get("/api/health").status_code == 200


def test_login_limit_is_ten_by_default_and_follows_the_setting() -> None:
    assert Settings().auth_rate_per_minute == 10
    app = create_app(Settings(auth_rate_per_minute=3))
    assert app.state.auth_limiter.per_minute == 3
