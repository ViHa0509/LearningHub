"""Provider failures sorted into the categories the connection test and the fallback use.

The Anthropic and OpenAI SDKs share their exception class names, so one classifier
handles both; it is given the SDK module the exception came from. The SDKs are imported
only when classifying: importing them takes seconds, and the MCP tool server (started for
every Claude Code answer) needs ProviderError without them.
"""

from types import ModuleType
from typing import Literal

ErrorCategory = Literal[
    "auth_failed", "invalid_model", "unavailable", "timeout", "rate_limited", "invalid_config"
]

# Errors after which trying another provider can help.
RECOVERABLE: frozenset[ErrorCategory] = frozenset({"timeout", "rate_limited", "unavailable"})

CATEGORY_LABELS: dict[str, str] = {
    "ok": "connected",
    "auth_failed": "authentication failed",
    "invalid_model": "invalid model",
    "unavailable": "provider unavailable",
    "timeout": "timeout",
    "rate_limited": "rate limited",
    "invalid_config": "invalid configuration",
}


class ProviderError(Exception):
    """The provider failed; the message is safe to show (it never holds the key)."""

    def __init__(self, message: str, category: ErrorCategory = "unavailable") -> None:
        super().__init__(message)
        self.category: ErrorCategory = category

    @property
    def recoverable(self) -> bool:
        return self.category in RECOVERABLE


DETAIL_LIMIT = 300


def _body_detail(body: object) -> str | None:
    """The provider's own error text: OpenAI-style {"error": {"message"}} or, as Gemini sends
    it, a list holding that object (the SDK then reports only "Error code: N")."""
    if isinstance(body, list) and body:
        body = body[0]
    if isinstance(body, dict):
        error = body.get("error", body)
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"].strip() or None
    return None


def _message(exc: Exception) -> str:
    text = str(getattr(exc, "message", None) or str(exc)).strip()
    body = getattr(exc, "body", None)
    if body is None:
        response = getattr(exc, "response", None)
        try:
            body = response.json() if response is not None else None
        except Exception:  # not JSON: keep the SDK's text
            body = None
    detail = _body_detail(body)
    if detail and detail not in text:
        text = f"{text}: {detail[:DETAIL_LIMIT]}" if text else detail[:DETAIL_LIMIT]
    return text or exc.__class__.__name__


def _classify(exc: Exception, sdk: ModuleType) -> ProviderError:
    message = _message(exc)
    category: ErrorCategory
    if isinstance(exc, sdk.AuthenticationError | sdk.PermissionDeniedError):
        category = "auth_failed"
    elif isinstance(exc, sdk.NotFoundError):
        category = "invalid_model"
    elif isinstance(exc, sdk.RateLimitError):
        category = "rate_limited"
    # APITimeoutError is a subclass of APIConnectionError: check it first.
    elif isinstance(exc, sdk.APITimeoutError):
        category = "timeout"
    elif isinstance(exc, sdk.APIConnectionError | sdk.InternalServerError):
        category = "unavailable"
    elif isinstance(exc, sdk.BadRequestError):
        category = "invalid_model" if "model" in message.lower() else "invalid_config"
    elif isinstance(exc, sdk.APIStatusError):
        category = "unavailable" if exc.status_code >= 500 else "invalid_config"
    else:
        category = "invalid_config"
    return ProviderError(message, category)


def classify_anthropic(exc: Exception) -> ProviderError:
    import anthropic

    return _classify(exc, anthropic)


def classify_openai(exc: Exception) -> ProviderError:
    import openai

    return _classify(exc, openai)
