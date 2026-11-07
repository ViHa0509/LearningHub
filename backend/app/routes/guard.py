"""Shared dependencies of the provider and agent routes."""

from fastapi import HTTPException, Request

from app.agent.llm.factory import ChatModelFactory
from app.agent.llm.urls import Resolver
from app.agent.secrets import SecretBox

APP_HEADER = "X-LearningHub"


def require_app_header(request: Request) -> None:
    """Mutating calls must come from the app itself: other origins and sandboxed note pages
    cannot add this header without a CORS preflight, which the backend never allows."""
    if request.headers.get(APP_HEADER) != "1":
        raise HTTPException(
            status_code=403,
            detail=f"this request must come from the Learning Hub app ({APP_HEADER})",
        )


def box_of(request: Request) -> SecretBox:
    box: SecretBox = request.app.state.box
    return box


def factory_of(request: Request) -> ChatModelFactory:
    factory: ChatModelFactory = request.app.state.llm_factory
    return factory


def resolver_of(request: Request) -> Resolver:
    resolver: Resolver = request.app.state.url_resolver
    return resolver
