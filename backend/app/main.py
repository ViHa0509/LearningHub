import logging
import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
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
    agent,
    agents,
    ai_providers,
    auth,
    domains,
    lessons,
    news,
    notes,
    resources,
)
from app.storage import LocalFileStore

# Routes whose 422 answers use ``detail: [{field, msg}]`` (the provider settings forms).
FIELD_ERROR_PREFIXES = ("/api/ai-providers", "/api/agents")


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


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app. Invalid roadmap files raise RoadmapError, so the server refuses to start."""
    settings = settings or get_settings()

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
    app.state.store = LocalFileStore(settings.storage_dir)
    app.state.box = SecretBox.from_settings(settings)
    app.state.url_resolver = socket.getaddrinfo
    app.state.llm_factory = LLMFactory(
        resolve=socket.getaddrinfo, claude_code_setup=ClaudeCodeSetup.from_settings(settings)
    )
    app.state.rate_limiter = RateLimiter(settings.agent_rate_per_minute)
    app.state.clock = utc_now
    app.state.auth_limiter = AuthLimiter(10)
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
    for module in (domains, notes, lessons, agent, ai_providers, agents, resources, news):
        app.include_router(module.router, dependencies=gate)
    return app


app = create_app()
