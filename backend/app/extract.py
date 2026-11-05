"""Title and readable text from a Claude-generated HTML page."""

import re
from dataclasses import dataclass
from pathlib import PurePath

from bs4 import BeautifulSoup

NON_TEXT_TAGS = ("script", "style", "noscript", "template", "svg")
META_CHARSET = re.compile(rb"""<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_\-:.]+)""", re.I)
WHITESPACE = re.compile(r"\s+")


class UndecodableError(ValueError):
    """The file is not text in UTF-8 or in the charset it declares."""


@dataclass(frozen=True)
class Extracted:
    title: str
    text: str


def decode_html(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    match = META_CHARSET.search(data[:4096])
    if match:
        charset = match.group(1).decode("ascii", "ignore")
        try:
            return data.decode(charset)
        except (LookupError, UnicodeDecodeError):
            pass
    raise UndecodableError("not decodable as UTF-8 or as its declared charset")


def _clean(text: str) -> str:
    return WHITESPACE.sub(" ", text).strip()


def extract(html: str, filename: str) -> Extracted:
    soup = BeautifulSoup(html, "lxml")

    title = ""
    if soup.title is not None:
        title = _clean(soup.title.get_text())
    if not title:
        h1 = soup.find("h1")
        if h1 is not None:
            title = _clean(h1.get_text(" "))
    if not title:
        title = PurePath(filename).stem or filename

    for tag in soup(NON_TEXT_TAGS):
        tag.decompose()
    root = soup.body or soup
    text = _clean(root.get_text(" "))
    return Extracted(title=title, text=text)
