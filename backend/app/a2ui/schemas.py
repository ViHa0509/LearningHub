"""API shapes of interactive surfaces (design 7)."""

import uuid
from typing import Any, Literal

from pydantic import BaseModel


class SurfaceOut(BaseModel):
    """A surface of a chat answer: its A2UI v0.9 messages never hold an answer; a stored chat
    adds one result update per answered question."""

    id: uuid.UUID
    kind: Literal["quiz", "practice", "lesson"]
    title: str
    messages: list[dict[str, Any]]
