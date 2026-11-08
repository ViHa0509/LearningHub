"""Reading a node's stored references, in display order."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import NodeResource

TYPE_ORDER = ("official", "course", "book", "article", "opensource", "video", "roadmap", "podcast")
_RANK = {kind: rank for rank, kind in enumerate(TYPE_ORDER)}


def sort_key(row: NodeResource) -> tuple[int, str, str]:
    return (_RANK.get(row.type, len(TYPE_ORDER)), row.title.casefold(), row.url)


def node_resources(session: Session, node_id: str) -> list[NodeResource]:
    """The node's references: by type (official first, unknown types last), then title."""
    rows = session.scalars(select(NodeResource).where(NodeResource.node_id == node_id)).all()
    return sorted(rows, key=sort_key)
