"""Matching helpers shared by the agent's ``search_notes`` tool and the top-bar search route."""


def like_pattern(query: str) -> str:
    """A ``%query%`` pattern where ``\\``, ``%`` and ``_`` match only themselves.

    Use it with ``ilike(pattern, escape="\\\\")``.
    """
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def snippet(text: str, query: str, width: int = 90) -> str:
    """An excerpt of ``text`` around the first case-insensitive match of ``query``."""
    at = text.lower().find(query.lower())
    if at < 0:
        return text[: width * 2].strip()
    start = max(0, at - width)
    return ("…" if start else "") + text[start : at + len(query) + width].strip() + "…"
