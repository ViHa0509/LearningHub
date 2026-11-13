from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, select, text

from app.auth.sessions import COOKIE, LIFETIME, hash_token, new_token
from app.config import Settings
from app.db import User, UserSession
from app.main import create_app
from tests.agent_fakes import NoNetworkFactory, fake_resolver
from tests.auth_fakes import AuthKit, auth_kit

BACKEND_DIR = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures"
TEST_DATABASE_URL = "postgresql+psycopg://learninghub:learninghub@localhost:5434/learninghub_test"


def alembic_config() -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    return config


@pytest.fixture(scope="session", autouse=True)
def migrated_test_db() -> None:
    """Run the real migrations once per test session against the test database."""
    command.upgrade(alembic_config(), "head")


@pytest.fixture(autouse=True)
def clean_tables() -> None:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(
            text(
                "TRUNCATE notes, lessons, agent_providers, ai_providers, node_resources, "
                "news_items, agent_settings, users, oauth_accounts, sessions, auth_tokens, "
                "app_settings, sync_keys, invitations, oauth_pending, sync_uploads, "
                "chat_sessions, chat_messages"
            )
        )
    engine.dispose()


@pytest.fixture
def settings_factory(tmp_path: Path) -> Callable[..., Settings]:
    def make(**overrides: Any) -> Settings:
        values: dict[str, Any] = {
            "database_url": TEST_DATABASE_URL,
            "storage_dir": tmp_path / "storage",
            # Never pick up real provider keys from the environment in tests.
            "anthropic_api_key": None,
            "openai_api_key": None,
            "deepseek_api_key": None,
            "ollama_url": None,
            # Tests run with the login on (the authenticated client signs in), never with
            # real OAuth apps or a real mail server.
            "auth_required": True,
            "public_url": "http://localhost:5173",
            "github_client_id": None,
            "github_client_secret": None,
            "google_client_id": None,
            "google_client_secret": None,
            "smtp_host": None,
        }
        values.update(overrides)
        return Settings(**values)

    return make


@pytest.fixture
def settings(settings_factory: Callable[..., Settings]) -> Settings:
    return settings_factory()


OWNER_EMAIL = "owner@example.test"


def owner_session_token(app: FastAPI) -> str:
    """A fresh session of the admin (created when missing, without a password)."""
    now = datetime.now(UTC)
    token = new_token()
    with app.state.session_factory() as db:
        user = db.scalar(select(User).where(User.role == "admin"))
        if user is None:
            user = User(email=OWNER_EMAIL, email_verified_at=now, role="admin", preferences={})
            db.add(user)
            db.flush()
        db.add(
            UserSession(
                user_id=user.id,
                token_hash=hash_token(token),
                last_seen_at=now,
                expires_at=now + LIFETIME,
            )
        )
        db.commit()
    return token


def user_id_of(app: FastAPI, email: str | None = None) -> Any:
    """The id of the admin (or of the user with ``email``)."""
    with app.state.session_factory() as db:
        query = select(User.id)
        query = query.where(User.email == email) if email else query.where(User.role == "admin")
        return db.scalars(query).one()


@contextmanager
def signed_in_client(app: FastAPI, headers: dict[str, str] | None = None) -> Iterator[TestClient]:
    """A TestClient that carries the admin's session cookie."""
    with TestClient(
        app, headers=headers or {}, cookies={COOKIE: owner_session_token(app)}
    ) as test_client:
        yield test_client


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    """The app as the frontend calls it (signed in, with the app header); no DNS, no real
    providers."""
    app = create_app(settings)
    app.state.url_resolver = fake_resolver()
    app.state.llm_factory = NoNetworkFactory()
    with signed_in_client(app, headers={"X-LearningHub": "1"}) as test_client:
        yield test_client
    app.state.engine.dispose()


@pytest.fixture
def fixture_bytes() -> Callable[[str], bytes]:
    return lambda name: (FIXTURES / name).read_bytes()


@pytest.fixture
def kit(settings_factory: Callable[..., Settings]) -> Iterator["AuthKit"]:
    """An app with the login on, no session yet, a capturing mailer and a settable clock."""
    with auth_kit(settings_factory()) as made:
        yield made


MEMBER_EMAIL = "member@example.test"


def member_session_token(app: FastAPI) -> str:
    """A fresh session of a member (created when missing, without a password)."""
    now = datetime.now(UTC)
    token = new_token()
    with app.state.session_factory() as db:
        user = db.scalar(select(User).where(User.email == MEMBER_EMAIL))
        if user is None:
            user = User(email=MEMBER_EMAIL, email_verified_at=now, role="member", preferences={})
            db.add(user)
            db.flush()
        db.add(
            UserSession(
                user_id=user.id,
                token_hash=hash_token(token),
                last_seen_at=now,
                expires_at=now + LIFETIME,
            )
        )
        db.commit()
    return token


@pytest.fixture
def second_client(client: TestClient) -> Iterator[TestClient]:
    """The same app as `client`, signed in as a second user (a member)."""
    app: FastAPI = client.app  # type: ignore[assignment]
    with TestClient(
        app, headers={"X-LearningHub": "1"}, cookies={COOKIE: member_session_token(app)}
    ) as other:
        yield other


# Serverless mode needs a file store every instance shares; these values name one (the tests
# that use them never store a file, so the fake address is never called).
SERVERLESS: dict[str, Any] = {
    "serverless": True,
    "storage_backend": "supabase",
    "supabase_url": "https://example.supabase.test",
    "supabase_service_key": SecretStr("test-service-key"),
}
