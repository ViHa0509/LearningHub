"""Markdown from an HTML page for the lesson editor.

The page is untrusted. Only Markdown text leaves this module: scripts, styles, navigation, forms,
images and embedded content are dropped, links keep only http, https and mailto targets, and
page text is escaped so it cannot turn into Markdown structure it did not have.
"""

import re
from dataclasses import dataclass, replace
from typing import Any

from bs4 import BeautifulSoup, Tag
from bs4.element import NavigableString

from app.lesson_pdf import MAX_CHARS

MAX_DEPTH = 200
NO_TEXT_WARNING = "the page has no text to import"
CUT_WARNING = f"only the first part was imported (at most {MAX_CHARS:,} characters)"

DROPPED = (
    "script",
    "style",
    "noscript",
    "template",
    "svg",
    "head",
    "nav",
    "iframe",
    "object",
    "embed",
    "form",
    "button",
    "input",
    "select",
    "textarea",
    "audio",
    "video",
    "canvas",
    "img",
)
INLINE_TAGS = frozenset(
    {
        *("a", "abbr", "b", "bdi", "bdo", "big", "br", "cite", "code", "data", "del", "dfn"),
        *("em", "font", "i", "ins", "kbd", "label", "mark", "q", "s", "samp", "small", "span"),
        *("strike", "strong", "sub", "sup", "time", "tt", "u", "var", "wbr"),
    }
)
HEADINGS = {f"h{n}": n for n in range(1, 7)}
BOLD = frozenset({"strong", "b"})
ITALIC = frozenset({"em", "i"})
LISTS = frozenset({"ul", "ol"})
# Containers whose text is never taken for preformatted text.
NOT_PREFORMATTED = frozenset({"p", "li", "td", "th", *HEADINGS})

WHITESPACE = re.compile(r"\s+")
ESCAPED_CHARS = re.compile(r"[\\`*_\[\]<>~&]")
BACKTICKS = re.compile(r"`+")
LANGUAGE = re.compile(r"language-([A-Za-z0-9_+-]{1,20})")
# A link target: only these schemes, and nothing that could end the Markdown link early.
LINK_SCHEME = re.compile(r"(?i)(https?://|mailto:)")
LINK_FORBIDDEN = re.compile(r"[\s()<>\\\x00-\x1f\x7f]")
LINE_START_NUMBER = re.compile(r"^(\d+)([.)])")
LINE_START_MARK = "#+-=~|"
BREAK = "\x00"  # a <br> inside a run of inline text, until the lines are joined


@dataclass(frozen=True)
class ExtractedHtml:
    markdown: str
    truncated: bool
    warning: str | None


@dataclass(frozen=True)
class Ctx:
    flat: bool = False  # one line only: headings, list items, table cells
    cell: bool = False  # inside a table cell: `|` is escaped
    in_link: bool = False


def _escape(text: str, ctx: Ctx) -> str:
    text = ESCAPED_CHARS.sub(lambda m: "\\" + m.group(0), text)
    return text.replace("|", "\\|") if ctx.cell else text


def _is_text(node: Any) -> bool:
    # Comments, doctypes, CDATA and the like are other NavigableString subclasses.
    return type(node) is NavigableString


def _raw_text(tag: Tag) -> str:
    """The text of an element verbatim; a <br> is a line break."""
    parts: list[str] = []
    for node in tag.descendants:
        if isinstance(node, Tag):
            if node.name == "br":
                parts.append("\n")
        elif _is_text(node):
            parts.append(str(node))
    return "".join(parts).replace(BREAK, "").replace("\r\n", "\n").replace("\r", "\n")


def _has_block(tag: Tag) -> bool:
    return any(isinstance(d, Tag) and d.name not in INLINE_TAGS for d in tag.descendants)


def _code_span(text: str) -> str:
    text = WHITESPACE.sub(" ", text).strip()
    if not text:
        return ""
    longest = max((len(run) for run in BACKTICKS.findall(text)), default=0)
    fence = "`" * (longest + 1)
    pad = " " if text.startswith("`") or text.endswith("`") else ""
    return f"{fence}{pad}{text}{pad}{fence}"


def _wrap(marker: str, inner: str) -> str:
    """Emphasis around the text, with the surrounding spaces kept outside the markers."""
    core = inner.strip(" ")
    if not core.strip(BREAK):
        return inner
    lead = " " if inner.startswith(" ") else ""
    trail = " " if inner.endswith(" ") else ""
    return f"{lead}{marker}{core}{marker}{trail}"


def _link_target(tag: Tag) -> str | None:
    href = tag.get("href")
    if not isinstance(href, str):
        return None
    href = href.strip()
    if LINK_SCHEME.match(href) and not LINK_FORBIDDEN.search(href):
        return href
    return None


def _inline(node: Any, ctx: Ctx, depth: int) -> str:
    """Markdown for an inline node; whitespace is collapsed by the caller."""
    if _is_text(node):
        return _escape(WHITESPACE.sub(" ", str(node).replace(BREAK, "")), ctx)
    if not isinstance(node, Tag) or node.name in DROPPED:
        return ""
    if depth > MAX_DEPTH:
        return _escape(WHITESPACE.sub(" ", _raw_text(node)), ctx)
    name = node.name
    if name == "br":
        return " " if ctx.flat else BREAK
    if name == "code":
        span = _code_span(_raw_text(node).replace("\n", " "))
        return span.replace("|", "\\|") if ctx.cell else span
    inner_ctx = replace(ctx, in_link=True) if name == "a" else ctx
    inner = "".join(_inline(child, inner_ctx, depth + 1) for child in node.children)
    if name in BOLD:
        return _wrap("**", inner)
    if name in ITALIC:
        return _wrap("*", inner)
    if name == "a":
        target = _link_target(node)
        core = inner.strip(" ")
        if ctx.in_link or target is None or not core.strip(BREAK):
            return inner
        lead = " " if inner.startswith(" ") else ""
        trail = " " if inner.endswith(" ") else ""
        return f"{lead}[{core}]({target}){trail}"
    # Any other element met inside inline text is read as its text, set off by spaces.
    return inner if name in INLINE_TAGS else f" {inner} "


def _line_start(line: str) -> str:
    """Keep a line of page text from starting a heading, list, rule, fence or table."""
    if line and line[0] in LINE_START_MARK:
        return "\\" + line
    return LINE_START_NUMBER.sub(r"\1\\\2", line, count=1)


def _paragraph(nodes: list[Any], depth: int) -> str | None:
    text = "".join(_inline(n, Ctx(), depth) for n in nodes)
    lines = [WHITESPACE.sub(" ", seg).strip() for seg in text.split(BREAK)]
    lines = [_line_start(line) for line in lines if line]
    return "  \n".join(lines) if lines else None


def _flat(nodes: list[Any], ctx: Ctx, depth: int) -> str:
    text = "".join(_inline(n, ctx, depth) for n in nodes)
    return WHITESPACE.sub(" ", text).strip()


def _fenced(text: str, language: str = "") -> str | None:
    text = re.sub(r"\A(?:[ \t]*\n)+", "", text)
    text = text.rstrip()
    if not text.strip():
        return None
    longest = max((len(run) for run in BACKTICKS.findall(text)), default=0)
    fence = "`" * max(3, longest + 1)
    return f"{fence}{language}\n{text}\n{fence}"


def _language(pre: Tag) -> str:
    classes: list[str] = list(pre.get_attribute_list("class"))
    code = pre.find("code")
    if isinstance(code, Tag):
        classes.extend(code.get_attribute_list("class"))
    for name in classes:
        match = LANGUAGE.fullmatch(name)
        if match:
            return match.group(1)
    return ""


def _list(tag: Tag, depth: int) -> list[str]:
    ordered = tag.name == "ol"
    lines: list[str] = []
    count = 0
    for child in tag.children:
        if not isinstance(child, Tag) or child.name in DROPPED:
            continue
        if child.name in LISTS:
            lines.extend("  " + line for line in _list(child, depth + 1))
            continue
        if child.name == "li":
            own = [c for c in child.children if not (isinstance(c, Tag) and c.name in LISTS)]
            nested = [c for c in child.children if isinstance(c, Tag) and c.name in LISTS]
        else:
            own, nested = [child], []
        text = _flat(own, Ctx(flat=True), depth + 1)
        text = _line_start(text) if text else ""
        nested_lines: list[str] = []
        if depth < MAX_DEPTH:
            for sub in nested:
                nested_lines.extend(_list(sub, depth + 1))
        if not text and not nested_lines:
            continue
        count += 1
        marker = f"{count}. " if ordered else "- "
        lines.append((marker + text).rstrip())
        lines.extend(" " * len(marker) + line for line in nested_lines)
    return lines


def _own_rows(table: Tag) -> list[Tag]:
    return [tr for tr in table.find_all("tr") if tr.find_parent("table") is table]


def _table(table: Tag, depth: int) -> list[str]:
    ctx = Ctx(flat=True, cell=True)
    rows: list[list[str]] = []
    for tr in _own_rows(table):
        cells = [c for c in tr.children if isinstance(c, Tag) and c.name in ("td", "th")]
        if cells:
            rows.append([_flat(list(c.children), ctx, depth + 1) for c in cells])
    if not rows:
        return []
    width = max(len(r) for r in rows)
    padded = [r + [""] * (width - len(r)) for r in rows]

    def line(cells: list[str]) -> str:
        return "| " + " | ".join(cells) + " |"

    out: list[str] = []
    caption = table.find("caption")
    if isinstance(caption, Tag):
        text = _paragraph(list(caption.children), depth + 1)
        if text:
            out.append(text)
    out.append("\n".join([line(padded[0]), line(["---"] * width), *(line(r) for r in padded[1:])]))
    return out


def _is_preformatted(tag: Tag) -> str | None:
    """Text of a container that holds only lines of text (an ASCII diagram), else None."""
    if tag.name in NOT_PREFORMATTED or any(isinstance(c, Tag) for c in tag.children):
        return None
    text = _raw_text(tag)
    if sum(1 for ln in text.split("\n") if ln.strip()) >= 2:
        return text
    return None


def _block(tag: Tag, depth: int) -> list[str]:
    name = tag.name
    if name in DROPPED:
        return []
    if depth > MAX_DEPTH:
        text = _paragraph([tag], depth)
        return [text] if text else []
    if name in HEADINGS:
        text = _flat(list(tag.children), Ctx(flat=True), depth + 1)
        if not text:
            return []
        if text.endswith("#"):
            text = text[:-1] + "\\#"
        return [f"{'#' * HEADINGS[name]} {text}"]
    if name == "p":
        text = _paragraph(list(tag.children), depth + 1)
        return [text] if text else []
    if name in LISTS:
        lines = _list(tag, depth)
        return ["\n".join(lines)] if lines else []
    if name == "pre":
        block = _fenced(_raw_text(tag), _language(tag))
        return [block] if block else []
    if name == "blockquote":
        inner = "\n\n".join(_blocks(list(tag.children), depth + 1))
        if not inner:
            return []
        return ["\n".join(f"> {ln}" if ln else ">" for ln in inner.split("\n"))]
    if name == "hr":
        return ["---"]
    if name == "table":
        return _table(tag, depth)
    verbatim = _is_preformatted(tag)
    if verbatim is not None:
        block = _fenced(verbatim)
        return [block] if block else []
    return _blocks(list(tag.children), depth + 1)


def _blocks(children: list[Any], depth: int) -> list[str]:
    """Blocks of a container, in order; inline content between blocks becomes paragraphs."""
    out: list[str] = []
    run: list[Any] = []

    def flush() -> None:
        if run:
            text = _paragraph(run, depth)
            if text:
                out.append(text)
            run.clear()

    for child in children:
        if _is_text(child):
            run.append(child)
        elif isinstance(child, Tag):
            if child.name in INLINE_TAGS and child.name not in DROPPED and not _has_block(child):
                run.append(child)
            else:
                flush()
                out.extend(_block(child, depth))
    flush()
    return out


def extract_html(html: str) -> ExtractedHtml:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup.find_all(DROPPED):
        tag.extract()
    for comment in soup.find_all(string=lambda s: not _is_text(s)):
        comment.extract()
    root = soup.body or soup
    markdown = "\n\n".join(_blocks(list(root.children), 0)).strip()

    truncated = False
    if len(markdown) > MAX_CHARS:
        markdown = markdown[:MAX_CHARS].rsplit("\n", 1)[0].rstrip()
        truncated = True
    warning = None
    if not markdown.strip():
        markdown = ""
        warning = NO_TEXT_WARNING
    elif truncated:
        warning = CUT_WARNING
    return ExtractedHtml(markdown=markdown, truncated=truncated, warning=warning)
