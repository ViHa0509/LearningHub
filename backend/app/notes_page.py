"""The standalone HTML page of a note the agent saved, built from plain Markdown.

The model writes Markdown only; the layout is this fixed template (numbered section cards from
``## `` headings, a highlighted "Key takeaways" card, callouts from ``> [!KEY]`` and friends).
Raw HTML in the text is never passed through: markdown-it runs with ``html`` off, so it comes
out as escaped text, images are not rendered, and links get ``rel="noopener noreferrer"``.
The page is shown in a sandboxed iframe like every note.
"""

import html
import re
from typing import Any, cast

from markdown_it import MarkdownIt
from markdown_it.renderer import RendererHTML
from markdown_it.token import Token

CALLOUTS = {"NOTE": "Note", "TIP": "Tip", "WARNING": "Watch out", "KEY": "Key idea"}
ALERT = re.compile(r"^\[!(NOTE|TIP|WARNING|KEY)\][ \t]*\n?", re.IGNORECASE)
TAKEAWAYS = re.compile(r"^(key )?takeaways?$", re.IGNORECASE)
TAG = re.compile(r"<[^>]+>")

PAGE_STYLE = (
    ":root{color-scheme:light dark;--bg:#f7f7fa;--surface:#fff;--surface-2:#efeff6;"
    "--border:#dcdbe6;--text:#18162e;--muted:#5e5c74;--accent:#4338ca;--accent-soft:#e8e7fb;"
    "--on-accent:#fff;--secondary:#6d28d9;--warn:#a35b00}"
    "@media (prefers-color-scheme:dark){:root{--bg:#14131f;--surface:#1d1c2b;"
    "--surface-2:#262538;--border:#38374f;--text:#ecebf7;--muted:#a3a1ba;--accent:#a5a0ff;"
    "--accent-soft:#2b2a4a;--on-accent:#14131f;--secondary:#c4a6ff;--warn:#f0b35a}}"
    "*{box-sizing:border-box}"
    "body{margin:0;background:var(--bg);color:var(--text);"
    'font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
    "main{max-width:780px;margin:0 auto;padding:32px 16px 56px}"
    "h1{margin:0 0 6px;font-size:28px;line-height:1.25}"
    ".meta{margin:0 0 20px;color:var(--muted);font-size:14px}"
    "h3,h4{margin:18px 0 6px;line-height:1.3}"
    "p,ul,ol,pre,table{margin:0 0 12px}"
    "a{color:var(--accent)}"
    "code{padding:1px 5px;border-radius:5px;background:var(--surface-2);"
    "font:0.9em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}"
    "pre{overflow-x:auto;padding:12px 14px;border:1px solid var(--border);"
    "border-radius:8px;background:var(--surface-2)}"
    "pre code{padding:0;background:none}"
    "blockquote{margin:0 0 12px;padding:2px 14px;border-left:3px solid var(--border);"
    "color:var(--muted)}"
    "table{width:100%;border-collapse:collapse;font-size:14px}"
    "th,td{padding:6px 10px;border:1px solid var(--border);text-align:left;vertical-align:top}"
    "th{background:var(--surface-2)}"
    ".toc{margin:0 0 18px;padding:12px 16px;background:var(--surface-2);"
    "border:1px solid var(--border);border-radius:10px}"
    ".toc p{margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;"
    "letter-spacing:.06em;color:var(--muted)}"
    ".toc ol{margin:0;padding-left:20px;font-size:14px}"
    ".toc a{color:var(--text);text-decoration:none}"
    ".toc a:hover{color:var(--accent);text-decoration:underline}"
    ".intro{margin:0 0 16px}"
    "section.card{margin:0 0 14px;padding:16px 20px 18px;background:var(--surface);"
    "border:1px solid var(--border);border-radius:12px;scroll-margin-top:12px}"
    "section.card>:last-child{margin-bottom:0}"
    "section.card h2{display:flex;align-items:center;gap:10px;margin:0 0 10px;font-size:18px}"
    "section.card h2::before{content:attr(data-n);display:inline-flex;flex:none;"
    "align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;"
    "background:var(--accent-soft);color:var(--accent);font-size:14px;font-weight:700}"
    "section.takeaways{background:var(--accent-soft);border-color:var(--accent)}"
    "section.takeaways h2::before{background:var(--accent);color:var(--on-accent)}"
    "section.takeaways li::marker{color:var(--accent)}"
    "aside.callout{--c:var(--accent);margin:12px 0;padding:10px 14px;"
    "border:1px solid var(--border);border-left:4px solid var(--c);border-radius:8px;"
    "background:var(--surface-2)}"
    "aside.callout>:last-child{margin-bottom:0}"
    "aside.callout.tip{--c:var(--secondary)}"
    "aside.callout.warning{--c:var(--warn)}"
    "aside.callout.note{--c:var(--muted)}"
    ".label{margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;"
    "letter-spacing:.06em;color:var(--c)}"
)


def _link_open(self: Any, tokens: list[Token], idx: int, options: Any, env: Any) -> str:
    tokens[idx].attrSet("rel", "noopener noreferrer")
    tokens[idx].attrSet("target", "_blank")
    return str(self.renderToken(tokens, idx, options, env))


def _markdown() -> MarkdownIt:
    # html=False: raw HTML in the text is escaped. No images: nothing is loaded from the web.
    md = MarkdownIt("commonmark", {"html": False, "linkify": False}).enable("table")
    md.disable("image")
    md.add_render_rule("link_open", _link_open)
    return md


def _mark_callouts(tokens: list[Token]) -> None:
    """Turns ``> [!KEY] text`` blockquotes into labeled asides (in place)."""
    i = 0
    while i < len(tokens):
        token = tokens[i]
        i += 1
        if token.type != "blockquote_open" or i + 1 >= len(tokens):
            continue
        inline = tokens[i + 1]
        if tokens[i].type != "paragraph_open" or inline.type != "inline":
            continue
        found = ALERT.match(inline.content)
        if found is None:
            continue
        kind = found.group(1).upper()
        inline.content = inline.content[found.end() :]
        children = inline.children or []
        if children and children[0].type == "text":
            children[0].content = ALERT.sub("", children[0].content, count=1)
            if not children[0].content:
                del children[0]
                if children and children[0].type == "softbreak":
                    del children[0]
        token.tag = "aside"
        token.attrSet("class", f"callout {kind.lower()}")
        label = Token("html_block", "", 0)
        label.content = f'<p class="label">{CALLOUTS[kind]}</p>\n'
        tokens.insert(i, label)
        depth = 0
        for j in range(i + 1, len(tokens)):
            if tokens[j].type == "blockquote_open":
                depth += 1
            elif tokens[j].type == "blockquote_close":
                if depth == 0:
                    tokens[j].tag = "aside"
                    break
                depth -= 1


def build_note_page(title: str, markdown: str) -> str:
    """A complete HTML document for ``markdown``; every character of the text is escaped."""
    md = _markdown()
    env: dict[str, Any] = {}
    renderer = cast(RendererHTML, md.renderer)
    tokens = md.parse(markdown, env)
    _mark_callouts(tokens)

    def render(part: list[Token]) -> str:
        return str(renderer.render(part, md.options, env))

    intro: list[Token] = []
    sections: list[tuple[str, list[Token]]] = []  # (heading as HTML, body tokens)
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token.type == "heading_open" and token.tag == "h2":
            heading = tokens[i + 1].children or []
            sections.append((str(renderer.renderInline(heading, md.options, env)), []))
            i += 3  # heading_open, inline, heading_close
            continue
        (sections[-1][1] if sections else intro).append(token)
        i += 1

    parts: list[str] = []
    intro_html = render(intro).strip() if intro else ""
    if intro_html:
        parts.append(f'<div class="intro">{intro_html}</div>')
    toc: list[str] = []
    for n, (heading_html, body) in enumerate(sections, start=1):
        plain = TAG.sub("", heading_html)
        css = "card takeaways" if TAKEAWAYS.match(html.unescape(plain).strip()) else "card"
        toc.append(f'<li><a href="#s{n}">{plain}</a></li>')
        parts.append(
            f'<section class="{css}" id="s{n}" aria-labelledby="s{n}-h">'
            f'<h2 id="s{n}-h" data-n="{n}">{heading_html}</h2>{render(body)}</section>'
        )
    toc_html = (
        f'<nav class="toc" aria-label="On this page"><p>On this page</p><ol>{"".join(toc)}</ol>'
        "</nav>"
        if len(sections) >= 3
        else ""
    )
    safe_title = html.escape(title)
    return (
        '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{safe_title}</title><style>{PAGE_STYLE}</style></head>"
        f'<body><main><h1>{safe_title}</h1><p class="meta">Saved by the learning agent</p>'
        f"{toc_html}{''.join(parts)}</main></body></html>\n"
    )
