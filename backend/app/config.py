from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Runtime settings, read from environment variables or backend/.env."""

    model_config = SettingsConfigDict(env_prefix="LH_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://learninghub:learninghub@localhost:5434/learninghub"
    roadmaps_dir: Path = REPO_ROOT / "roadmaps"
    storage_dir: Path = REPO_ROOT / "storage"
    max_upload_bytes: int = 10 * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
