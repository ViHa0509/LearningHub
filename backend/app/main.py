import logging

from fastapi import FastAPI
from sqlalchemy.exc import SQLAlchemyError

from app.agent.ratelimit import RateLimiter
from app.agent.registry import ProviderRegistry, default_factory
from app.agent.secrets import SecretBox
from app.config import Settings, get_settings
from app.db import make_engine, make_session_factory
from app.roadmaps import RoadmapCatalog
from app.routes import agent, domains, lessons, notes
from app.storage import LocalFileStore


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app. Invalid roadmap files raise RoadmapError, so the server refuses to start."""
    settings = settings or get_settings()
    app = FastAPI(title="Learning Hub API", version="0.1.0")
    app.state.settings = settings
    app.state.catalog = RoadmapCatalog.load(settings.roadmaps_dir)
    app.state.engine = make_engine(settings.database_url)
    app.state.session_factory = make_session_factory(app.state.engine)
    app.state.store = LocalFileStore(settings.storage_dir)
    app.state.registry = ProviderRegistry(
        settings, SecretBox.from_settings(settings), default_factory
    )
    app.state.rate_limiter = RateLimiter(settings.agent_rate_per_minute)
    try:
        with app.state.session_factory() as session:
            app.state.registry.reload(session)
    except SQLAlchemyError:
        # Database not migrated yet (or down): keys from backend/.env still work.
        logging.getLogger(__name__).warning(
            "could not read provider settings; run 'alembic upgrade head'", exc_info=True
        )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(domains.router)
    app.include_router(notes.router)
    app.include_router(lessons.router)
    app.include_router(agent.router)
    return app


app = create_app()
