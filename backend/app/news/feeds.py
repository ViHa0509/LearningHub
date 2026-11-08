"""Parse RSS 2.0 and Atom feeds with the standard library.

Feed text is untrusted: a document that declares a DTD or entities is refused before parsing
(no entity expansion), titles and summaries become plain text (tags, scripts and styles
removed), the summary is cut to 400 characters, and only http(s) links are kept.
"""

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

from app.extract import NON_TEXT_TAGS

ATOM = "{http://www.w3.org/2005/Atom}"
DC_DATE = "{http://purl.org/dc/elements/1.1/}date"
SUMMARY_CHARS = 400
MAX_ITEMS = 200
ELLIPSIS = chr(0x2026)
UNSAFE = re.compile(r"<!\s*(DOCTYPE|ENTITY)", re.IGNORECASE)
WHITESPACE = re.compile(r"\s+")


class FeedError(Exception):
    """The feed cannot be read; the message is safe to show."""


@dataclass(frozen=True)
class FeedItem:
    title: str
    url: str
    published_at: datetime
    summary: str


def plain_text(markup: str | None) -> str:
    """Text without tags, scripts or styles, with whitespace collapsed."""
    if not markup or not markup.strip():
        return ""
    if "<" not in markup and "&" not in markup:
        return WHITESPACE.sub(" ", markup).strip()
    soup = BeautifulSoup(markup, "lxml")
    for tag in soup(NON_TEXT_TAGS):
        tag.decompose()
    return WHITESPACE.sub(" ", soup.get_text(" ")).strip()


def shorten(text: str, limit: int = SUMMARY_CHARS) -> str:
    """At most ``limit`` characters, cut at a word boundary with an ellipsis."""
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    space = cut.rfind(" ")
    if space > limit // 2:
        cut = cut[:space]
    return cut.rstrip(" ,;:.-") + ELLIPSIS


def _local(tag: object) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _element_markup(element: ET.Element | None) -> str:
    """The element's content as markup: its text, or (XHTML content) its children's text."""
    if element is None:
        return ""
    if len(element) == 0:
        return element.text or ""
    for parent in list(element.iter()):
        for child in list(parent):
            if _local(child.tag) in NON_TEXT_TAGS:
                parent.remove(child)
    return " ".join(element.itertext())


def _http_url(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    try:
        parts = urlsplit(value)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return value


def _date(value: str | None, fetched_at: datetime) -> datetime:
    """Timezone-aware; a missing, invalid or future date becomes the fetch time."""
    if not value or not value.strip():
        return fetched_at
    value = value.strip()
    parsed: datetime | None = None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return fetched_at
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return min(parsed, fetched_at)


def _item(
    title: str, url: str | None, date: str | None, summary: str, fetched_at: datetime
) -> FeedItem | None:
    if url is None:
        return None
    return FeedItem(
        title=shorten(plain_text(title), 500) or url,
        url=url,
        published_at=_date(date, fetched_at),
        summary=shorten(plain_text(summary)),
    )


def _rss(root: ET.Element, fetched_at: datetime) -> list[FeedItem]:
    channel = root.find("channel")
    if channel is None:
        raise FeedError("the RSS feed has no channel")
    items: list[FeedItem] = []
    for entry in channel.findall("item"):
        url = _http_url(entry.findtext("link"))
        guid = entry.find("guid")
        if url is None and guid is not None and guid.get("isPermaLink", "true") != "false":
            url = _http_url(guid.text)
        date = entry.findtext("pubDate") or entry.findtext(DC_DATE)
        item = _item(
            entry.findtext("title") or "",
            url,
            date,
            _element_markup(entry.find("description")),
            fetched_at,
        )
        if item is not None:
            items.append(item)
    return items


def _atom_link(entry: ET.Element) -> str | None:
    for link in entry.findall(f"{ATOM}link"):
        if link.get("rel", "alternate") == "alternate":
            url = _http_url(link.get("href"))
            if url is not None:
                return url
    return None


def _atom(root: ET.Element, fetched_at: datetime) -> list[FeedItem]:
    items: list[FeedItem] = []
    for entry in root.findall(f"{ATOM}entry"):
        summary = entry.find(f"{ATOM}summary")
        if summary is None:
            summary = entry.find(f"{ATOM}content")
        date = entry.findtext(f"{ATOM}published") or entry.findtext(f"{ATOM}updated")
        item = _item(
            _element_markup(entry.find(f"{ATOM}title")),
            _atom_link(entry),
            date,
            _element_markup(summary),
            fetched_at,
        )
        if item is not None:
            items.append(item)
    return items


def parse_feed(text: str, fetched_at: datetime) -> list[FeedItem]:
    """Items of an RSS 2.0 or Atom feed, in feed order; FeedError when it cannot be read."""
    if UNSAFE.search(text):
        raise FeedError("the feed declares a DTD or entities")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise FeedError("the feed is not valid XML") from exc
    if root.tag == "rss":
        items = _rss(root, fetched_at)
    elif root.tag == f"{ATOM}feed":
        items = _atom(root, fetched_at)
    else:
        raise FeedError("the document is not an RSS 2.0 or Atom feed")
    return items[:MAX_ITEMS]
