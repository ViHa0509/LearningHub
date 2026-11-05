from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.config import Settings
from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures"
TEST_DATABASE_URL = "postgresql+psycopg://learninghub:learninghub@localhost:5434/learninghub_test"


@pytest.fixture(scope="session", autouse=True)
def migrated_test_db() -> None:
    """Run the real migrations once per test session against the test database."""
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.upgrade(config, "head")


@pytest.fixture(autouse=True)
def clean_tables() -> None:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE notes"))
    engine.dispose()


@pytest.fixture
def settings_factory(tmp_path: Path) -> Callable[..., Settings]:
    def make(**overrides: Any) -> Settings:
        values: dict[str, Any] = {
            "database_url": TEST_DATABASE_URL,
            "storage_dir": tmp_path / "storage",
        }
        values.update(overrides)
        return Settings(**values)

    return make


@pytest.fixture
def settings(settings_factory: Callable[..., Settings]) -> Settings:
    return settings_factory()


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app = create_app(settings)
    with TestClient(app) as test_client:
        yield test_client
    app.state.engine.dispose()


@pytest.fixture
def fixture_bytes() -> Callable[[str], bytes]:
    return lambda name: (FIXTURES / name).read_bytes()
