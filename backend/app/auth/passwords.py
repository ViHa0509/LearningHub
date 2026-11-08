"""Password hashing with scrypt from the standard library.

The parameters are stored in the hash (``scrypt$N$r$p$salt$hash``) so they can be raised
later without breaking existing hashes.
"""

import base64
import hashlib
import hmac
import secrets
from functools import lru_cache

N = 2**15
R = 8
P = 1
SALT_BYTES = 16
KEY_BYTES = 32
# scrypt needs 128 * r * N bytes (32 MiB here); leave room for higher stored parameters.
MAXMEM = 64 * 1024 * 1024
# Refuse stored parameters that would make one check use too much memory or time.
MAX_N = 2**17
MIN_LENGTH = 10
MAX_LENGTH = 1024


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _derive(password: str, salt: bytes, n: int, r: int, p: int, length: int) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=n, r=r, p=p, maxmem=MAXMEM, dklen=length
    )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    digest = _derive(password, salt, N, R, P, KEY_BYTES)
    return f"scrypt${N}${R}${P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    """True when ``password`` matches; a malformed stored hash never matches."""
    try:
        scheme, n_text, r_text, p_text, salt_text, hash_text = stored.split("$")
        n, r, p = int(n_text), int(r_text), int(p_text)
        salt = base64.b64decode(salt_text, validate=True)
        expected = base64.b64decode(hash_text, validate=True)
    except ValueError:
        return False
    if scheme != "scrypt" or not (2 <= n <= MAX_N) or not (1 <= r <= 16) or not (1 <= p <= 4):
        return False
    if not expected or len(expected) > 64:
        return False
    try:
        actual = _derive(password, salt, n, r, p, len(expected))
    except (ValueError, MemoryError):
        return False
    return hmac.compare_digest(actual, expected)


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    return hash_password(secrets.token_urlsafe(16))


def burn_time(password: str) -> None:
    """Spend the same time as a real check, for unknown emails (no timing difference)."""
    verify_password(password, _dummy_hash())
