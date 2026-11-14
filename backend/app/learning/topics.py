"""Validation of the topic list of an area, shared by the editor route, the agent tool and the
restore."""

from collections.abc import Sequence
from dataclasses import dataclass

from app.roadmaps import KEBAB

MAX_TOPICS = 300
SLUG_MAX = 60
TITLE_MAX = 80
DESCRIPTION_MAX = 300


@dataclass(frozen=True)
class TopicError:
    """What is wrong: ``index`` is the row (None for the list as a whole)."""

    index: int | None
    field: str
    msg: str

    def as_dict(self) -> dict[str, object]:
        return {"index": self.index, "field": self.field, "msg": self.msg}


@dataclass(frozen=True)
class TopicData:
    slug: str
    title: str
    description: str
    parent: str | None


def clean_topics(
    rows: Sequence[tuple[str, str, str | None, str | None]],
) -> tuple[list[TopicData], list[TopicError]]:
    """Check ``(slug, title, description, parent)`` rows; returns the cleaned topics and every
    error found (the topics are only usable when there is no error)."""
    errors: list[TopicError] = []
    if len(rows) > MAX_TOPICS:
        return [], [TopicError(None, "topics", f"at most {MAX_TOPICS} topics")]
    topics: list[TopicData] = []
    seen: dict[str, int] = {}
    for index, (raw_slug, raw_title, raw_description, raw_parent) in enumerate(rows):
        slug = raw_slug.strip()
        title = raw_title.strip()
        description = (raw_description or "").strip()
        parent = (raw_parent or "").strip() or None
        if not slug or len(slug) > SLUG_MAX or not KEBAB.match(slug):
            errors.append(
                TopicError(index, "slug", f"'{slug[:SLUG_MAX]}' is not lowercase kebab-case")
            )
        elif slug in seen:
            errors.append(TopicError(index, "slug", f"slug '{slug}' is used twice"))
        else:
            seen[slug] = index
        if not title or len(title) > TITLE_MAX:
            errors.append(TopicError(index, "title", f"title must be 1 to {TITLE_MAX} characters"))
        if len(description) > DESCRIPTION_MAX:
            errors.append(
                TopicError(
                    index,
                    "description",
                    f"description must be at most {DESCRIPTION_MAX} characters",
                )
            )
        topics.append(TopicData(slug, title, description, parent))
    for index, topic in enumerate(topics):
        if topic.parent is None:
            continue
        if topic.parent == topic.slug:
            errors.append(TopicError(index, "parent", "a topic cannot be its own parent"))
        elif topic.parent not in seen:
            errors.append(TopicError(index, "parent", f"parent '{topic.parent}' does not exist"))
    if not errors:
        parents = {t.slug: t.parent for t in topics}
        for index, topic in enumerate(topics):
            visited = {topic.slug}
            current = topic.parent
            while current is not None:
                if current in visited:
                    errors.append(TopicError(index, "parent", "the parents form a cycle"))
                    break
                visited.add(current)
                current = parents[current]
    return topics, errors
