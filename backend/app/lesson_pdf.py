"""Text of a PDF for the lesson editor: paragraphs and bullet lists, within fixed limits.

The PDF comes from the user's own computer but is still parsed defensively: page and character
limits bound the work, and errors come back as messages, never as stack traces.
"""

import html
import io
import logging
import re
from dataclasses import dataclass

from pypdf import PdfReader
from pypdf.errors import PdfReadError

MAX_PAGES = 200
MAX_CHARS = 100_000
# Bullet characters PDFs use: bullet, white bullet, small squares, triangle, dots, en dash,
# hyphen and asterisk (code points, so the source stays plain ASCII).
BULLETS = "".join(
    map(
        chr,
        (
            0x2022,
            0x25E6,
            0x25AA,
            0x25AB,
            0x2023,
            0x2219,
            0x25CF,
            0x25CB,
            0x25A0,
            0x25A1,
            0x2013,
            0x2D,
            0x2A,
        ),
    )
)
BULLET_LINE = re.compile(rf"^\s*[{re.escape(BULLETS)}]\s+(.*)$")
NUMBERED_LINE = re.compile(r"^\s*(\d{1,3})[.)]\s+(.*)$")
LIST_ITEM = re.compile(r"^\d{1,3}\. ")


class PdfImportError(ValueError):
    """The file cannot be imported; the message is shown to the user."""


@dataclass
class ExtractedPdf:
    markdown: str
    pages: int
    truncated: bool
    warning: str | None
    # The first non-empty line of the text, before lines are joined into paragraphs.
    first_line: str = ""


def _paragraphs(text: str) -> list[str]:
    """Lines of one page joined into paragraphs; list items stay one per line."""
    blocks: list[str] = []
    current: list[str] = []

    def flush() -> None:
        if current:
            blocks.append(" ".join(current))
            current.clear()

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            flush()
            continue
        bullet = BULLET_LINE.match(line)
        numbered = NUMBERED_LINE.match(line)
        if bullet:
            flush()
            blocks.append(f"- {bullet.group(1).strip()}")
        elif numbered:
            flush()
            blocks.append(f"{numbered.group(1)}. {numbered.group(2).strip()}")
        elif blocks and not current and _is_item(blocks[-1]) and line[:1].islower():
            # A wrapped list item continues on the next line.
            blocks[-1] = f"{blocks[-1]} {line}"
        else:
            # A hyphen at the end of a line joins a word split across lines.
            if current and current[-1].endswith("-") and line[:1].islower():
                current[-1] = current[-1][:-1] + line
            else:
                current.append(line)
    flush()
    return blocks


def extract_pdf(data: bytes) -> ExtractedPdf:
    if not data.startswith(b"%PDF-"):
        raise PdfImportError("the file is not a PDF")
    # pypdf logs warnings about odd files; they are not the user's problem.
    logging.getLogger("pypdf").setLevel(logging.ERROR)
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            raise PdfImportError("the PDF is password-protected; remove the password and try again")
        pages = len(reader.pages)
        blocks: list[str] = []
        first_line = ""
        size = 0
        truncated = pages > MAX_PAGES
        for page in reader.pages[:MAX_PAGES]:
            page_text = page.extract_text() or ""
            if not first_line:
                first_line = next((ln.strip() for ln in page_text.splitlines() if ln.strip()), "")
            page_blocks = _paragraphs(page_text)
            blocks.extend(page_blocks)
            size += sum(len(b) + 2 for b in page_blocks)
            if size > MAX_CHARS:
                truncated = True
                break
    except PdfImportError:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError, IndexError) as exc:
        raise PdfImportError("the PDF could not be read; it may be damaged") from exc

    markdown = _join(blocks)
    if len(markdown) > MAX_CHARS:
        markdown = markdown[:MAX_CHARS].rsplit("\n", 1)[0]
        truncated = True
    warning = None
    if not markdown.strip():
        warning = "the PDF has no text to import (it may be scanned images)"
    elif truncated:
        warning = (
            f"only the first part was imported (at most {MAX_PAGES} pages "
            f"and {MAX_CHARS:,} characters)"
        )
    return ExtractedPdf(
        markdown=markdown, pages=pages, truncated=truncated, warning=warning, first_line=first_line
    )


PAGE_STYLE = (
    "body{font:16px/1.6 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;"
    "max-width:760px;margin:32px auto;padding:0 16px;color:#18162e;background:#fff}"
    "h1{font-size:26px;line-height:1.25}"
)


def pdf_note_html(extracted: ExtractedPdf, filename: str) -> tuple[str, str]:
    """A note page for an imported PDF: (title, HTML). Every character of the PDF is escaped."""
    first = BULLET_LINE.sub(r"\1", extracted.first_line).strip()
    title = first[:120] if first else (filename.rsplit(".", 1)[0] or "Imported PDF")
    parts: list[str] = []
    for block in extracted.markdown.split("\n\n"):
        lines = [line for line in block.split("\n") if line.strip()]
        if not lines:
            continue
        if all(line.startswith("- ") for line in lines):
            items = "".join(f"<li>{html.escape(line[2:])}</li>" for line in lines)
            parts.append(f"<ul>{items}</ul>")
        elif all(LIST_ITEM.match(line) for line in lines):
            items = "".join(
                f"<li>{html.escape(LIST_ITEM.sub('', line, count=1))}</li>" for line in lines
            )
            parts.append(f"<ol>{items}</ol>")
        else:
            parts.append(f"<p>{html.escape(' '.join(lines))}</p>")
    page = (
        '<!DOCTYPE html>\n<html><head><meta charset="utf-8">'
        f"<title>{html.escape(title)}</title><style>{PAGE_STYLE}</style></head>"
        f"<body><h1>{html.escape(title)}</h1>"
        # No file name in the page: the same PDF under another name is a duplicate.
        f'<p style="color:#5e5c74">Imported from a PDF ({extracted.pages} pages)</p>'
        f"{''.join(parts)}</body></html>\n"
    )
    return title, page


def _is_item(block: str) -> bool:
    return block.startswith("- ") or bool(LIST_ITEM.match(block))


def _join(blocks: list[str]) -> str:
    """Paragraphs separated by a blank line; consecutive list items stay together."""
    text = ""
    for i, block in enumerate(blocks):
        if i:
            text += "\n" if _is_item(block) and _is_item(blocks[i - 1]) else "\n\n"
        text += block
    return text.strip()
