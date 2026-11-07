"""Spec: ai-providers - keys are encrypted with the app's secret; the chat rate limiter."""

from pathlib import Path
from typing import Any

import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr

from app.agent.ratelimit import RateLimiter
from app.agent.secrets import SecretBox, SecretUnreadable, key_hint, load_or_create_key_file

KEY = "sk-ant-api03-abcd1234"


def test_secret_box_round_trip_and_wrong_key() -> None:
    box = SecretBox(Fernet.generate_key())
    token = box.encrypt(KEY)
    assert KEY not in token
    assert box.decrypt(token) == KEY
    with pytest.raises(SecretUnreadable, match="enter it again"):
        SecretBox(Fernet.generate_key()).decrypt(token)


def test_key_file_is_created_once_and_reused(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "secret.key"
    first = load_or_create_key_file(path)
    assert path.exists()
    assert load_or_create_key_file(path) == first


def test_passphrase_from_settings(settings_factory: Any) -> None:
    a = SecretBox.from_settings(settings_factory(secret_key=SecretStr("my passphrase")))
    b = SecretBox.from_settings(settings_factory(secret_key=SecretStr("my passphrase")))
    assert b.decrypt(a.encrypt("x")) == "x"


def test_key_hint_shows_only_the_last_four() -> None:
    assert key_hint(KEY) == "…1234"
    assert key_hint("short") == "…"


def test_rate_limiter_window() -> None:
    now = [0.0]
    limiter = RateLimiter(2, clock=lambda: now[0])
    assert limiter.acquire() is None
    assert limiter.acquire() is None
    now[0] = 10.0
    assert limiter.acquire() == 50
    now[0] = 60.5
    assert limiter.acquire() is None
