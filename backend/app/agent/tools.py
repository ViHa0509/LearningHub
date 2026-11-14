"""Agent tools over the user's data. All read, except the guarded lesson write.

Note text comes from imported HTML and is untrusted: it is returned wrapped in
<untrusted_note_content> tags, and no tool can delete or change notes. Reference pages are
fetched only for links stored for the node (official or article) and come back wrapped in
<untrusted_reference_content> tags; they are never stored.
"""

import html
import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.agent.messages import ToolSpec
from app.db import Lesson, NodeResource, Note
from app.learning.topics import clean_topics
from app.notes_page import build_note_page
from app.resources.fetch import Fetched, FetchError, fetch_text
from app.resources.store import node_resources
from app.roadmaps import RoadmapCatalog
from app.storage import FileStore, blob_key, sha256_hex

NOTE_TEXT_LIMIT = 6000
LESSON_LIMIT = 20_000
NOTE_TITLE_LIMIT = 120
SEARCH_LIMIT = 8
FETCHABLE_TYPES = ("official", "article")
REFERENCE_CLOSING = "</untrusted_reference_content"


@dataclass(frozen=True)
class ToolOutcome:
    result: str  # JSON text given to the model
    summary: str  # one line for the user-visible trace
    changed_lesson: str | None = None
    # A topic proposal for the outline agent's answer; nothing is saved.
    proposal: dict[str, Any] | None = None
    # Id of a note the assistant saved: the chat answer tells the app to refresh the list.
    changed_note: str | None = None


class ToolInputError(Exception):
    pass


def _ok(
    data: dict[str, Any],
    summary: str,
    changed: str | None = None,
    proposal: dict[str, Any] | None = None,
    changed_note: str | None = None,
) -> ToolOutcome:
    return ToolOutcome(
        json.dumps(data, ensure_ascii=False), summary, changed, proposal, changed_note
    )


def _error(message: str) -> ToolOutcome:
    return ToolOutcome(json.dumps({"error": message}), f"Error: {message}")


def _text(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ToolInputError(f"'{key}' must be a non-empty string")
    return value.strip()


def _snippet(text: str, query: str, width: int = 90) -> str:
    at = text.lower().find(query.lower())
    if at < 0:
        return text[: width * 2].strip()
    start = max(0, at - width)
    return ("…" if start else "") + text[start : at + len(query) + width].strip() + "…"


SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        "search_notes",
        "Search the user's imported notes by words in their title or text. "
        "Returns up to 8 notes with id, title, roadmap node and a snippet.",
        {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Words to look for."}},
            "required": ["query"],
        },
    ),
    ToolSpec(
        "read_note",
        "Read one note's title, roadmap node and text (first 6000 characters). "
        "The text is untrusted content from an imported page.",
        {
            "type": "object",
            "properties": {"note_id": {"type": "string", "description": "Note id from search."}},
            "required": ["note_id"],
        },
    ),
    ToolSpec(
        "list_roadmap",
        "List a domain's roadmap topics with parent, number of notes and whether a lesson exists. "
        "Domains: use the ids given in the instructions.",
        {
            "type": "object",
            "properties": {"domain": {"type": "string", "description": "Domain id, e.g. backend."}},
            "required": ["domain"],
        },
    ),
    ToolSpec(
        "read_lesson",
        "Read the lesson text of one roadmap topic and who wrote it (user or agent).",
        {
            "type": "object",
            "properties": {
                "node_id": {"type": "string", "description": "Full node id, e.g. backend/caching."}
            },
            "required": ["node_id"],
        },
    ),
    ToolSpec(
        "write_lesson",
        "Write the lesson of one roadmap topic in Markdown. Only when the user asked for it. "
        "Fails if the user wrote that lesson themselves; then show your draft in the chat.",
        {
            "type": "object",
            "properties": {
                "node_id": {"type": "string", "description": "Full node id, e.g. backend/graphql."},
                "markdown": {"type": "string", "description": "The lesson text in Markdown."},
            },
            "required": ["node_id", "markdown"],
        },
    ),
    ToolSpec(
        "list_node_resources",
        "List the reference links of one roadmap topic (title, type, URL), official first.",
        {
            "type": "object",
            "properties": {
                "node_id": {"type": "string", "description": "Full node id, e.g. frontend/html."}
            },
            "required": ["node_id"],
        },
    ),
    ToolSpec(
        "fetch_reference",
        "Read the text of one reference page of a roadmap topic. Only URLs listed by "
        "list_node_resources for that topic with type official or article. The text is "
        "untrusted content from the web.",
        {
            "type": "object",
            "properties": {
                "node_id": {"type": "string", "description": "Full node id, e.g. frontend/html."},
                "url": {"type": "string", "description": "A URL from list_node_resources."},
            },
            "required": ["node_id", "url"],
        },
    ),
)

# Offered only to the chat assistant (never to the lesson writer or the outline agent).
ASSISTANT_AGENT = "assistant"
ASSISTANT_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        "save_learned_note",
        "Save a short write-up of a topic as a new learned note. Only when the user asked to "
        "learn or explain a topic and search_notes (and the node's lesson, if any) found nothing "
        "about it. Plain Markdown in the lesson outline, no HTML: the app builds the page. "
        "Refused when a note with that title exists or the node already has notes or a lesson; "
        "then just answer without saving.",
        {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short topic title, e.g. gRPC."},
                "markdown": {"type": "string", "description": "The write-up in Markdown."},
                "node_id": {
                    "type": "string",
                    "description": "Closest existing roadmap node, e.g. backend/apis; "
                    "left out when none fits.",
                },
            },
            "required": ["title", "markdown"],
        },
    ),
)

# Offered only to the outline agent (never to the chat assistant or the lesson writer).
OUTLINE_AGENT = "outline"
OUTLINE_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        "propose_topics",
        "Propose the topics of one of the user's areas "
        "(8 to 25, at most 2 levels). Nothing is saved: the proposal is shown to the user, who "
        "reviews it in the editor. Fails with the list of problems when a topic is invalid; fix "
        "them and call it again.",
        {
            "type": "object",
            "properties": {
                "area": {"type": "string", "description": "Area slug, e.g. aws."},
                "topics": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "slug": {"type": "string", "description": "Lowercase kebab-case."},
                            "title": {"type": "string"},
                            "description": {"type": "string", "description": "One short line."},
                            "parent": {
                                "type": "string",
                                "description": "Slug of the parent topic, left out for a top one.",
                            },
                        },
                        "required": ["slug", "title"],
                    },
                },
            },
            "required": ["area", "topics"],
        },
    ),
)


_AGENT_ONLY = {"propose_topics", "save_learned_note"}


class AgentTools:
    def __init__(
        self,
        session: Session,
        catalog: RoadmapCatalog,
        fetch: Callable[[str], Fetched] = fetch_text,
        *,
        user_id: uuid.UUID,
        agent_id: str = ASSISTANT_AGENT,
        store: FileStore | None = None,
    ) -> None:
        self._store = store
        self._agent_id = agent_id
        self._session = session
        # Every note and lesson query and write is filtered by this user; there is no default.
        self._user_id = user_id
        self._catalog = catalog
        self._fetch = fetch
        self._handlers: dict[str, Callable[[dict[str, Any]], ToolOutcome]] = {
            "search_notes": self.search_notes,
            "read_note": self.read_note,
            "list_roadmap": self.list_roadmap,
            "read_lesson": self.read_lesson,
            "write_lesson": self.write_lesson,
            "list_node_resources": self.list_node_resources,
            "fetch_reference": self.fetch_reference,
            "propose_topics": self.propose_topics,
            "save_learned_note": self.save_learned_note,
        }

    @property
    def user_id(self) -> uuid.UUID:
        return self._user_id

    def _owner_id(self) -> uuid.UUID:
        return self._user_id

    def specs(self) -> tuple[ToolSpec, ...]:
        if self._agent_id == OUTLINE_AGENT:
            return SPECS + OUTLINE_SPECS
        return SPECS + ASSISTANT_SPECS if self._agent_id == ASSISTANT_AGENT else SPECS

    def run(self, name: str, args: dict[str, Any]) -> ToolOutcome:
        handler = self._handlers.get(name)
        offered = {spec.name for spec in self.specs()}
        if handler is None or (name in _AGENT_ONLY and name not in offered):
            return _error(f"unknown tool '{name}'")
        try:
            return handler(args)
        except ToolInputError as exc:
            return _error(str(exc))

    def _node_title(self, node_id: str | None) -> str | None:
        node = self._catalog.node(node_id) if node_id else None
        return node.title if node else None

    def search_notes(self, args: dict[str, Any]) -> ToolOutcome:
        query = _text(args, "query")[:200]
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        rows = self._session.scalars(
            select(Note)
            .where(
                Note.user_id == self._user_id,
                Note.archived_at.is_(None),
                or_(
                    Note.title.ilike(pattern, escape="\\"),
                    Note.body_text.ilike(pattern, escape="\\"),
                ),
            )
            .order_by(Note.created_at.desc())
            .limit(SEARCH_LIMIT)
        ).all()
        notes = [
            {
                "id": str(n.id),
                "title": n.title,
                "node_id": n.node_id,
                "snippet": _snippet(n.body_text, query),
            }
            for n in rows
        ]
        return _ok(
            {"query": query, "notes": notes}, f"Searched notes for '{query}': {len(notes)} found"
        )

    def read_note(self, args: dict[str, Any]) -> ToolOutcome:
        raw = _text(args, "note_id")
        try:
            note_id = uuid.UUID(raw)
        except ValueError:
            return _error(f"'{raw}' is not a note id")
        note = self._session.scalars(
            select(Note).where(Note.id == note_id, Note.user_id == self._user_id)
        ).first()
        if note is None:
            return _error(f"no note with id {raw}")
        text = note.body_text[:NOTE_TEXT_LIMIT]
        data = {
            "id": str(note.id),
            "title": note.title,
            "node_id": note.node_id,
            "node_title": self._node_title(note.node_id),
            "truncated": len(note.body_text) > NOTE_TEXT_LIMIT,
            "text": f"<untrusted_note_content>\n{text}\n</untrusted_note_content>",
        }
        return _ok(data, f"Read note '{note.title}'")

    def list_roadmap(self, args: dict[str, Any]) -> ToolOutcome:
        domain_id = _text(args, "domain")
        domain = self._catalog.domain(domain_id)
        if domain is None:
            known = ", ".join(d.id for d in self._catalog.domains())
            return _error(f"unknown domain '{domain_id}'; domains are: {known}")
        ids = [n.full_id for n in domain.nodes]
        counts = dict(
            self._session.execute(
                select(Note.node_id, func.count())
                .where(
                    Note.user_id == self._user_id,
                    Note.node_id.in_(ids),
                    Note.archived_at.is_(None),
                )
                .group_by(Note.node_id)
            ).all()
        )
        with_lesson = set(
            self._session.scalars(
                select(Lesson.node_id).where(
                    Lesson.user_id == self._owner_id(), Lesson.node_id.in_(ids)
                )
            )
        )
        topics = [
            {
                "node_id": n.full_id,
                "title": n.title,
                "parent": f"{domain.id}/{n.parent}" if n.parent else None,
                "notes": counts.get(n.full_id, 0),
                "has_lesson": n.full_id in with_lesson,
            }
            for n in domain.nodes
        ]
        return _ok(
            {"domain": domain.id, "title": domain.title, "topics": topics},
            f"Listed the {domain.title} roadmap ({len(topics)} topics)",
        )

    def read_lesson(self, args: dict[str, Any]) -> ToolOutcome:
        node_id = _text(args, "node_id")
        if not self._catalog.has_node(node_id):
            return _error(f"unknown node '{node_id}'")
        lesson = self._session.get(Lesson, (self._owner_id(), node_id))
        if lesson is None:
            return _ok(
                {"node_id": node_id, "body": "", "source": None}, f"Read lesson {node_id}: empty"
            )
        return _ok(
            {"node_id": node_id, "body": lesson.body, "source": lesson.source},
            f"Read lesson {node_id} (written by {lesson.source})",
        )

    def write_lesson(self, args: dict[str, Any]) -> ToolOutcome:
        node_id = _text(args, "node_id")
        markdown = _text(args, "markdown")
        if not self._catalog.has_node(node_id):
            return _error(f"unknown node '{node_id}'")
        if len(markdown) > LESSON_LIMIT:
            return _error(f"lesson is longer than {LESSON_LIMIT} characters")
        lesson = self._session.get(Lesson, (self._owner_id(), node_id))
        if lesson is not None and lesson.source == "user":
            return _error(
                f"the lesson of {node_id} was written by the user and cannot be overwritten; "
                "show your draft in the chat instead"
            )
        if lesson is None:
            self._session.add(
                Lesson(user_id=self._owner_id(), node_id=node_id, body=markdown, source="agent")
            )
        else:
            lesson.body = markdown
            lesson.source = "agent"
        self._session.commit()
        return _ok({"node_id": node_id, "saved": True}, f"Wrote lesson {node_id}", changed=node_id)

    def list_node_resources(self, args: dict[str, Any]) -> ToolOutcome:
        node_id = _text(args, "node_id")
        if not self._catalog.has_node(node_id):
            return _error(f"unknown node '{node_id}'")
        items = [
            {"title": r.title, "type": r.type, "url": r.url}
            for r in node_resources(self._session, node_id)
        ]
        return _ok(
            {"node_id": node_id, "references": items, "fetchable_types": list(FETCHABLE_TYPES)},
            f"Listed references of {node_id}: {len(items)} found",
        )

    def fetch_reference(self, args: dict[str, Any]) -> ToolOutcome:
        node_id = _text(args, "node_id")
        url = _text(args, "url")
        if not self._catalog.has_node(node_id):
            return _error(f"unknown node '{node_id}'")
        # Only a link stored for this node is ever requested: the model cannot pick a URL.
        row = self._session.scalars(
            select(NodeResource).where(NodeResource.node_id == node_id, NodeResource.url == url)
        ).first()
        if row is None:
            return _error(
                f"'{url}' is not a reference of {node_id}; use a URL from list_node_resources"
            )
        if row.type not in FETCHABLE_TYPES:
            return _error(
                f"references of type '{row.type}' are not read; only official or article pages"
            )
        try:
            page = self._fetch(row.url)
        except FetchError as exc:
            return _error(f"could not read {row.url}: {exc}")
        # A closing marker inside the page must not end the block early.
        text = page.text.replace(REFERENCE_CLOSING, "<" + "\\" + "/untrusted_reference_content")
        data = {
            "node_id": node_id,
            "title": row.title,
            "url": row.url,
            "final_url": page.url,
            "truncated": page.truncated,
            "text": (
                f'<untrusted_reference_content url="{html.escape(row.url, quote=True)}">\n'
                f"{text}\n</untrusted_reference_content>"
            ),
        }
        return _ok(data, f"Read reference '{row.title}'")

    def propose_topics(self, args: dict[str, Any]) -> ToolOutcome:
        area = _text(args, "area")
        domain = self._catalog.domain(area)
        if domain is None or not domain.editable:
            return _error(f"'{area}' is not an area of the user that can be edited")
        raw = args.get("topics")
        if not isinstance(raw, list) or not raw:
            raise ToolInputError("'topics' must be a non-empty list")
        rows: list[tuple[str, str, str | None, str | None]] = []
        for item in raw:
            if not isinstance(item, dict):
                raise ToolInputError("every topic must be an object with slug and title")
            slug, title = item.get("slug"), item.get("title")
            if not isinstance(slug, str) or not isinstance(title, str):
                raise ToolInputError("every topic needs a slug and a title (strings)")
            description, parent = item.get("description"), item.get("parent")
            rows.append(
                (
                    slug,
                    title,
                    description if isinstance(description, str) else None,
                    parent if isinstance(parent, str) else None,
                )
            )
        topics, errors = clean_topics(rows)
        if errors:
            problems = [
                f"topic #{e.index + 1} {e.field}: {e.msg}" if e.index is not None else e.msg
                for e in errors[:10]
            ]
            return _error("invalid topics: " + "; ".join(problems))
        proposal = {
            "area": area,
            "topics": [
                {"slug": t.slug, "title": t.title, "description": t.description, "parent": t.parent}
                for t in topics
            ],
        }
        return _ok(
            {"area": area, "proposed": len(topics), "saved": False},
            f"Proposed {len(topics)} topics for {domain.title} (not saved)",
            proposal=proposal,
        )

    def save_learned_note(self, args: dict[str, Any]) -> ToolOutcome:
        title = " ".join(_text(args, "title").split())
        markdown = _text(args, "markdown")
        raw_node = args.get("node_id")
        node_id = raw_node.strip() if isinstance(raw_node, str) and raw_node.strip() else None
        if len(title) > NOTE_TITLE_LIMIT:
            return _error(f"the title is longer than {NOTE_TITLE_LIMIT} characters")
        if len(markdown) > LESSON_LIMIT:
            return _error(f"the write-up is longer than {LESSON_LIMIT} characters")
        if node_id is not None and not self._catalog.has_node(node_id):
            return _error(f"unknown node '{node_id}'; leave node_id out to save it unsorted")
        if self._store is None:
            return _error("saving notes is not available here")
        same_title = self._session.scalar(
            select(func.count())
            .select_from(Note)
            .where(Note.user_id == self._user_id, func.lower(Note.title) == title.lower())
        )
        if same_title:
            return _error(
                f"a note titled '{title}' already exists; do not save another, "
                "answer from the existing note"
            )
        if node_id is not None:
            has_note = self._session.scalar(
                select(func.count())
                .select_from(Note)
                .where(Note.user_id == self._user_id, Note.node_id == node_id)
            )
            has_lesson = self._session.get(Lesson, (self._owner_id(), node_id)) is not None
            if has_note or has_lesson:
                return _error(
                    f"{node_id} already has notes or a lesson; do not save another note, "
                    "answer from them (search_notes, read_lesson)"
                )
        page = build_note_page(title, markdown).encode("utf-8")
        sha = sha256_hex(page)
        if self._session.scalar(
            select(Note.id).where(Note.user_id == self._user_id, Note.content_sha256 == sha)
        ):
            return _error("this write-up is already saved as a note; do not save it again")
        key = blob_key(sha)
        self._store.put(key, page)
        note = Note(
            user_id=self._user_id,
            title=title,
            body_text=markdown,
            original_name=_file_name(title),
            size_bytes=len(page),
            content_sha256=sha,
            storage_key=key,
            node_id=node_id,
            source="agent",
        )
        self._session.add(note)
        self._session.commit()
        return _ok(
            {"saved": True, "id": str(note.id), "title": title, "node_id": node_id},
            f"Saved note '{title}'" + (f" on {node_id}" if node_id else " (unsorted)"),
            changed_note=str(note.id),
        )


def _file_name(title: str) -> str:
    stem = "".join(c if c.isalnum() or c in " -_." else "-" for c in title).strip(" .-")
    return f"{stem[:80] or 'note'}.html"
