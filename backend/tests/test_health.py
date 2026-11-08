"""Spec: learning-views - Service unavailable page (the health check it polls)."""

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


# Scenario: Database down
def test_health_reports_a_database_that_does_not_answer(
    settings_factory: Callable[..., Settings],
) -> None:
    # Nothing listens on port 1: the backend is up, its database is not.
    settings: Any = settings_factory(
        database_url="postgresql+psycopg://lh:lh@127.0.0.1:1/learninghub_test?connect_timeout=2"
    )
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "reason": "database"}
