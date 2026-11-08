"""Spec: auth - Email and password (passwords stored only as salted scrypt hashes)."""

import pytest

from app.auth.passwords import hash_password, verify_password
from app.auth.ratelimit import AuthLimiter
from app.auth.sessions import hash_token, new_token


def test_hash_has_scrypt_parameters_and_a_random_salt() -> None:
    first = hash_password("correct horse 1")
    second = hash_password("correct horse 1")
    scheme, n, r, p, salt, digest = first.split("$")
    assert len(salt) == 24 and len(digest) == 44  # 16 and 32 bytes, base64
    assert (scheme, n, r, p) == ("scrypt", str(2**15), "8", "1")
    assert first != second  # a fresh salt each time
    assert "correct horse" not in first


def test_verify_accepts_only_the_right_password() -> None:
    stored = hash_password("correct horse 1")
    assert verify_password("correct horse 1", stored)
    assert not verify_password("correct horse 2", stored)


@pytest.mark.parametrize(
    "stored",
    [
        "",
        "plain",
        "bcrypt$1$2$3$aa$bb",
        "scrypt$x$8$1$AAAA$AAAA",
        "scrypt$1048576$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA",  # too costly, refused
        "scrypt$32768$8$1$!!$AAAA",
    ],
)
def test_malformed_hashes_never_match(stored: str) -> None:
    assert not verify_password("anything at all", stored)


def test_session_tokens_are_random_and_stored_hashed() -> None:
    token = new_token()
    assert len(token) >= 40 and token != new_token()
    assert hash_token(token) != token and len(hash_token(token)) == 64


def test_limiter_counts_per_key_and_reopens_after_a_minute() -> None:
    now = [0.0]
    limiter = AuthLimiter(10, clock=lambda: now[0])
    for _ in range(10):
        assert limiter.hit(["ip:a"]) is None
    wait = limiter.hit(["ip:a"])
    assert wait is not None and 1 <= wait <= 60
    assert limiter.hit(["ip:b"]) is None
    now[0] = 60.0
    assert limiter.hit(["ip:a"]) is None
