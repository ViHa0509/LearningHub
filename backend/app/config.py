from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Runtime settings, read from environment variables or backend/.env."""

    model_config = SettingsConfigDict(env_prefix="LH_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://learninghub:learninghub@localhost:5434/learninghub"
    roadmaps_dir: Path = REPO_ROOT / "roadmaps"
    storage_dir: Path = REPO_ROOT / "storage"
    max_upload_bytes: int = 10 * 1024 * 1024

    # Agent providers: a provider is offered only when its key (or Ollama URL) is set.
    anthropic_api_key: SecretStr | None = None
    openai_api_key: SecretStr | None = None
    deepseek_api_key: SecretStr | None = None
    ollama_url: str | None = None
    agent_max_steps: int = 6
    agent_rate_per_minute: int = 20
    # Encrypts provider keys saved in the app; default: a key file in storage_dir.
    secret_key: SecretStr | None = None
    # The Claude Code CLI for the claude-code provider type; default: `claude` on the PATH.
    # A .py file runs with this Python (the e2e fake).
    claude_bin: str | None = None
    # Where reference links are synced from (roadmap.sh's repository on GitHub); tests point
    # these at a local fake server.
    roadmap_api_base: str = "https://api.github.com"
    roadmap_raw_base: str = "https://raw.githubusercontent.com"
    # The AI news feeds (checked at startup).
    news_sources_file: Path = REPO_ROOT / "news" / "sources.yaml"

    # Owner login. While false, the data routes stay open (the auth routes always work).
    auth_required: bool = False
    # Where the browser opens the app: OAuth redirect URIs and links in emails start here.
    public_url: str = "http://localhost:5173"
    github_client_id: str | None = None
    github_client_secret: SecretStr | None = None
    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None
    # OAuth endpoints; tests point these at a local fake provider.
    github_authorize_url: str = "https://github.com/login/oauth/authorize"
    github_token_url: str = "https://github.com/login/oauth/access_token"
    github_api_base: str = "https://api.github.com"
    google_authorize_url: str = "https://accounts.google.com/o/oauth2/v2/auth"
    google_token_url: str = "https://oauth2.googleapis.com/token"
    google_userinfo_url: str = "https://openidconnect.googleapis.com/v1/userinfo"
    # Email: SMTP when a host is set (STARTTLS, or SSL on port 465); else the local outbox.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: SecretStr | None = None
    smtp_from: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
