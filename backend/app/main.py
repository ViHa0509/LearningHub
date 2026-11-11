import logging
import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.agent.env_import import import_env_providers
from app.agent.llm.claude_code import ClaudeCodeSetup
from app.agent.llm.factory import LLMFactory
from app.agent.ratelimit import RateLimiter
from app.agent.secrets import SecretBox
from app.auth.mail import mailer_from_settings
from app.auth.oauth import PendingStore
from app.auth.ratelimit import AuthLimiter
from app.auth.sessions import require_session, utc_now
from app.config import Settings, get_settings
from app.db import make_engine, make_session_factory
from app.news.refresh import NewsJobs, default_fetcher
from app.news.sources import load_sources
from app.resources.mapping import load_mappings
from app.resources.sync import SyncJobs, http_get
from app.roadmaps import RoadmapCatalog
from app.routes import (
    admin,
    agent,
    agents,
    ai_providers,
    auth,
    data,
    data_upload,
    domains,
    lessons,
    news,
    notes,
    resources,
    settings_signin,
)
from app.storage import FileStore, LocalFileStore, SupabaseFileStore

# Routes whose 422 answers use ``detail: [{field, msg}]`` (the provider settings forms).
FIELD_ERROR_PREFIXES = ("/api/ai-providers", "/api/agents")


def build_store(settings: Settings) -> FileStore:
    """The note file store; a supabase backend with a missing setting refuses to start."""
    if settings.storage_backend == "local":
        return LocalFileStore(settings.storage_dir)
    key = settings.supabase_service_key
    missing = [
        name
        for name, value in (
            ("LH_SUPABASE_URL", (settings.supabase_url or "").strip()),
            ("LH_SUPABASE_SERVICE_KEY", key.get_secret_value().strip() if key else ""),
            ("LH_SUPABASE_BUCKET", settings.supabase_bucket.strip()),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(f"LH_STORAGE_BACKEND=supabase needs {', '.join(missing)} to be set")
    assert settings.supabase_url is not None and key is not None
    return SupabaseFileStore(
        settings.supabase_url, key.get_secret_value().strip(), settings.supabase_bucket.strip()
    )


def import_env(app: FastAPI) -> None:
    """Import LH_* provider values once; a database that is down or not migrated is tolerated."""
    try:
        with app.state.session_factory() as session:
            created = import_env_providers(session, app.state.settings, app.state.box)
        if created:
            logging.getLogger(__name__).info("imported providers from .env: %s", created)
    except SQLAlchemyError:
        logging.getLogger(__name__).warning(
            "could not import provider settings from .env; run 'alembic upgrade head'",
            exc_info=True,
        )


class PublicWithoutLogin(RuntimeError):
    """An https public address with the login off: the app would be open to the internet."""


def serve_static(app: FastAPI, root: Path) -> None:
    """Serve the built frontend: its files as they are, any other non-API path the app page."""
    root = root.resolve()
    index = root / "index.html"
    if not index.is_file():
        raise RuntimeError(f"LH_STATIC_DIR has no index.html: {root}")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str) -> Response:
        if path == "api" or path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        file = (root / path).resolve()
        if path and file.is_relative_to(root) and file.is_file():
            return FileResponse(file)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app. Invalid roadmap files raise RoadmapError, so the server refuses to start."""
    settings = settings or get_settings()
    if settings.public_url.startswith("https://") and not settings.auth_required:
        raise PublicWithoutLogin(
            "LH_PUBLIC_URL is a public https address but LH_AUTH_REQUIRED is false: "
            "the login must be on for a public address"
        )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        import_env(app)
        yield

    app = FastAPI(title="Learning Hub API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.catalog = RoadmapCatalog.load(settings.roadmaps_dir)
    # Invalid mappings (roadmaps/sources) raise RoadmapError too.
    app.state.resource_mappings = load_mappings(settings.roadmaps_dir, app.state.catalog)
    app.state.resource_sync = SyncJobs()
    app.state.resource_getter = http_get
    # An invalid news/sources.yaml raises NewsSourcesError (a RoadmapError).
    app.state.news_sources = load_sources(settings.news_sources_file)
    app.state.news_jobs = NewsJobs()
    app.state.news_fetcher = default_fetcher
    app.state.engine = make_engine(settings.database_url)
    app.state.session_factory = make_session_factory(app.state.engine)
    app.state.store = build_store(settings)
    app.state.box = SecretBox.from_settings(settings)
    app.state.url_resolver = socket.getaddrinfo
    app.state.llm_factory = LLMFactory(
        resolve=socket.getaddrinfo, claude_code_setup=ClaudeCodeSetup.from_settings(settings)
    )
    app.state.rate_limiter = RateLimiter(settings.agent_rate_per_minute)
    app.state.clock = utc_now
    app.state.sync_transport = None  # tests inject an httpx2 transport for the sync sender
    app.state.auth_limiter = AuthLimiter(settings.auth_rate_per_minute)
    app.state.oauth_pending = PendingStore()
    app.state.mailer = mailer_from_settings(settings)

    @app.exception_handler(RequestValidationError)
    async def field_errors(request: Request, exc: RequestValidationError) -> Response:
        if not request.url.path.startswith(FIELD_ERROR_PREFIXES):
            return await request_validation_exception_handler(request, exc)
        detail = []
        for error in exc.errors():
            loc = [str(p) for p in error.get("loc", ()) if p != "body" and not isinstance(p, int)]
            detail.append({"field": loc[-1] if loc else "body", "msg": str(error.get("msg"))})
        return JSONResponse(status_code=422, content={"detail": detail})

    @app.get("/api/health")
    def health() -> JSONResponse:
        """The app's outage page polls this; a database that does not answer is an outage."""
        try:
            with app.state.engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except SQLAlchemyError:
            return JSONResponse(
                status_code=503, content={"status": "unavailable", "reason": "database"}
            )
        return JSONResponse(content={"status": "ok"})

    app.include_router(auth.router)
    # Every data router needs a session (when the login is on); health and auth do not.
    gate = [Depends(require_session)]
    for module in (
        data,
        domains,
        notes,
        lessons,
        agent,
        ai_providers,
        agents,
        resources,
        news,
        settings_signin,
        admin,
    ):
        app.include_router(module.router, dependencies=gate)
    # The upload routes authenticate with the sync key, not a session.
    app.include_router(data_upload.router)
    # Last, so every API route matches first.
    if settings.static_dir is not None:
        serve_static(app, settings.static_dir)
    return app


app = create_app()
