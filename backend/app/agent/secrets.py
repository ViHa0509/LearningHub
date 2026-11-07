"""Encryption for provider keys saved in the app.

The encryption key is ``LH_SECRET_KEY`` when set, else a key file created on first
use in the storage folder (git-ignored, on this computer only).
"""

import base64
import hashlib
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from app.config import Settings

KEY_FILE = "secret.key"


class SecretUnreadable(Exception):
    """A stored value cannot be decrypted (the key file or LH_SECRET_KEY changed)."""


class SecretBox:
    def __init__(self, key: bytes) -> None:
        self._fernet = Fernet(key)

    @classmethod
    def from_settings(cls, settings: Settings) -> "SecretBox":
        if settings.secret_key is not None and settings.secret_key.get_secret_value().strip():
            # Any passphrase works: derive a valid Fernet key from it.
            digest = hashlib.sha256(settings.secret_key.get_secret_value().encode()).digest()
            return cls(base64.urlsafe_b64encode(digest))
        return cls(load_or_create_key_file(Path(settings.storage_dir) / KEY_FILE))

    def encrypt(self, text: str) -> str:
        return self._fernet.encrypt(text.encode()).decode()

    def decrypt(self, token: str) -> str:
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except InvalidToken as exc:
            raise SecretUnreadable("the saved key cannot be read; enter it again") from exc


def load_or_create_key_file(path: Path) -> bytes:
    if path.exists():
        return path.read_bytes().strip()
    path.parent.mkdir(parents=True, exist_ok=True)
    key = Fernet.generate_key()
    # Create exclusively so two processes starting together cannot overwrite each other.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(key)
    return key


def key_hint(key: str) -> str:
    return "…" + key[-4:] if len(key) >= 8 else "…"
