"""Spec: lesson-pages - Import an HTML page into the lesson editor (converter and the API)."""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.lesson_html import MAX_CHARS, extract_html
from app.main import create_app
from tests.conftest import signed_in_client
from tests.test_lesson_pdf import make_pdf


def md(body: str) -> str:
    return extract_html(f"<html><body>{body}</body></html>").markdown


# --- design 3: mapping ---------------------------------------------------------------------------


# Scenario: Import an HTML page and save (the conversion part)
def test_headings_paragraphs_lists_and_table() -> None:
    page = (
        "<h1>Kafka</h1><p>A log  of\n events.</p><h3>Parts</h3>"
        "<ul><li>topics</li><li>partitions</li></ul>"
        "<table><tr><th>Name</th><th>Role</th></tr><tr><td>broker</td><td>stores</td></tr></table>"
    )
    assert md(page) == (
        "# Kafka\n\nA log of events.\n\n### Parts\n\n- topics\n- partitions\n\n"
        "| Name | Role |\n| --- | --- |\n| broker | stores |"
    )


def test_every_heading_level() -> None:
    page = "".join(f"<h{n}>H{n}</h{n}>" for n in range(1, 7))
    assert md(page) == "\n\n".join(f"{'#' * n} H{n}" for n in range(1, 7))


def test_heading_text_stays_on_one_line() -> None:
    assert md("<h2>One<br>two\n three</h2>") == "## One two three"


def test_br_is_a_line_break() -> None:
    assert md("<p>one<br>two</p>") == "one  \ntwo"


def test_ordered_and_nested_lists() -> None:
    page = (
        "<ol><li>first<ul><li>a</li><li>b</li></ul></li><li>second<ol><li>x</li></ol></li></ol>"
        "<ul><li>top<ul><li>mid<ul><li>deep</li></ul></li></ul></li></ul>"
    )
    assert md(page) == (
        "1. first\n   - a\n   - b\n2. second\n   1. x\n\n- top\n  - mid\n    - deep"
    )


def test_list_item_text_comes_before_its_nested_list() -> None:
    assert md("<ul><li><ul><li>inner</li></ul>outer</li></ul>") == "- outer\n  - inner"


def test_pre_is_a_fenced_block_verbatim() -> None:
    page = "<pre>line 1\n  indented *star* &lt;tag&gt; | pipe\nline 3</pre>"
    assert md(page) == "```\nline 1\n  indented *star* <tag> | pipe\nline 3\n```"


def test_pre_fence_is_longer_than_any_backtick_run() -> None:
    assert md("<pre>a ``` b\nc</pre>") == "````\na ``` b\nc\n````"
    assert md("<pre>a ```` b</pre>") == "`````\na ```` b\n`````"


def test_pre_language_from_the_class() -> None:
    assert md('<pre><code class="language-python">x = 1</code></pre>') == "```python\nx = 1\n```"
    assert md('<pre class="language-c++ other">int x;</pre>') == "```c++\nint x;\n```"
    # A class that is not a plain language name is ignored.
    assert md('<pre class="lang-python highlight">x</pre>') == "```\nx\n```"
    assert md('<pre class="language-averyveryverylonglanguagename">x</pre>') == "```\nx\n```"
    assert md('<pre class="language-x.y">x</pre>') == "```\nx\n```"


def test_blockquote_hr_and_empty_pre() -> None:
    assert md("<blockquote><p>one</p><p>two</p></blockquote>") == "> one\n>\n> two"
    assert md("<p>a</p><hr><p>b</p>") == "a\n\n---\n\nb"
    assert md("<pre>  \n </pre><p>x</p>") == "x"


def test_table_pads_short_rows_and_escapes_pipes() -> None:
    page = (
        "<table><thead><tr><td>A | B</td><td>C</td><td>D</td></tr></thead>"
        "<tbody><tr><td>1</td></tr><tr><td>x<br>y</td><td><b>b</b></td><td><code>a|b</code></td>"
        "</tr></tbody></table>"
    )
    assert md(page) == (
        "| A \\| B | C | D |\n| --- | --- | --- |\n| 1 |  |  |\n| x y | **b** | `a\\|b` |"
    )


def test_table_without_rows_is_skipped() -> None:
    assert md("<table></table><table><tr></tr></table><p>after</p>") == "after"


def test_nested_table_rows_stay_with_their_own_table() -> None:
    page = "<table><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table>"
    assert md(page) == "| outer inner |\n| --- |"


def test_containers_pass_their_children_through() -> None:
    page = (
        "<div><section><article><h2>T</h2>loose text <b>bold</b><p>para</p>tail</article>"
        "</section></div><custom-tag>unknown</custom-tag>"
    )
    assert md(page) == "## T\n\nloose text **bold**\n\npara\n\ntail\n\nunknown"


def test_inline_content_before_and_after_a_block_makes_paragraphs() -> None:
    assert md("<div>before <span>span</span><ul><li>x</li></ul>after</div>") == (
        "before span\n\n- x\n\nafter"
    )


def test_preformatted_div_becomes_a_fenced_block() -> None:
    diagram = "┌──┐\n│  │\n└──┘"
    page = f'<div class="diagram">\n{diagram}\n</div>'
    assert md(page) == f"```\n{diagram}\n```"


def test_preformatted_rule_only_for_text_only_containers_with_two_lines() -> None:
    # One line of text, or a child element, or a paragraph: no fence.
    assert md("<div>one line</div>") == "one line"
    assert md("<div>a\nb <b>c</b></div>") == "a b **c**"
    assert md("<p>a\nb</p>") == "a b"
    assert md("<ul><li>a\nb</li></ul>") == "- a b"
    assert md("<table><tr><td>a\nb</td></tr></table>") == "| a b |\n| --- |"
    assert md("<h2>a\nb</h2>") == "## a b"


# --- design 4: inline ----------------------------------------------------------------------------


def test_bold_italic_and_code() -> None:
    page = "<p><strong>s</strong> <b>b</b> <em>e</em> <i>i</i> <code>c</code> x<b> sp </b>y</p>"
    assert md(page) == "**s** **b** *e* *i* `c` x **sp** y"


def test_code_span_delimiters() -> None:
    assert md("<p><code>a`b</code></p>") == "``a`b``"
    assert md("<p><code>`a</code></p>") == "`` `a ``"
    assert md("<p><code>a``b`c`</code></p>") == "``` a``b`c` ```"
    assert md("<p><code>a *b* _c_</code></p>") == "`a *b* _c_`"


def test_empty_emphasis_code_and_links_emit_nothing() -> None:
    assert md("<p>a<b></b><i> </i><code></code><a href='https://x.test'></a>b</p>") == "a b"
    assert md("<p>a <a href='https://x.test'> </a>b</p>") == "a b"


@pytest.mark.parametrize(
    "href",
    [
        "https://example.test/a?b=1",
        "HTTP://example.test",
        "mailto:me@example.test",
        " https://x.test ",
    ],
)
def test_links_with_allowed_schemes_are_kept(href: str) -> None:
    assert md(f'<p><a href="{href}">label</a></p>') == f"[label]({href.strip()})"


@pytest.mark.parametrize(
    "href",
    [
        "javascript:alert(1)",
        "JavaScript:alert(1)",
        "data:text/html,<b>x</b>",
        "#section",
        "/relative/path",
        "ftp://example.test",
        "https://example.test/a b",
        "https://example.test/a(b)",
        "https://example.test/<x>",
        "https://example.test/a\\b",
        "https://example.test/\tx",
        "vbscript:x",
        "",
    ],
)
def test_other_links_become_plain_text(href: str) -> None:
    assert md(f'<p><a href="{href}">label</a></p>') == "label"


def test_link_without_href_and_formatted_link_text() -> None:
    assert md("<p><a>plain</a></p>") == "plain"
    assert md('<p><a href="https://x.test"><b>bold</b> and [br]</a></p>') == (
        "[**bold** and \\[br\\]](https://x.test)"
    )


def test_nested_anchors_are_parsed_as_siblings() -> None:
    page = '<a href="https://a.test">outer <a href="https://b.test">inner</a></a>'
    assert md(page) == "[outer](https://a.test) [inner](https://b.test)"


# --- design 5: escaping --------------------------------------------------------------------------


def test_special_characters_are_escaped() -> None:
    assert md("<p>a\\b `c` *d* _e_ [f] &lt;g&gt; h|i</p>") == (
        "a\\\\b \\`c\\` \\*d\\* \\_e\\_ \\[f\\] \\<g\\> h|i"
    )


# Scenario: Page text stays text
def test_text_that_looks_like_markdown_stays_text() -> None:
    assert md("<p>*not bold* # not a heading</p>") == "\\*not bold\\* # not a heading"
    assert md("<p># not a heading</p>") == "\\# not a heading"


@pytest.mark.parametrize(
    ("text", "escaped"),
    [
        ("# h", "\\# h"),
        ("+ item", "\\+ item"),
        ("- item", "\\- item"),
        ("--- rule", "\\--- rule"),
        ("=== setext", "\\=== setext"),
        ("1. item", "1\\. item"),
        ("12) item", "12\\) item"),
        ("~~~ fence", "\\~\\~\\~ fence"),
        ("| a | b |", "\\| a | b |"),
        ("> quote", "\\> quote"),
        ("``` fence", "\\`\\`\\` fence"),
        ("<b>x</b>", "\\<b\\>x\\</b\\>"),
        ("1.5 stays", "1\\.5 stays"),
    ],
)
def test_line_start_is_escaped(text: str, escaped: str) -> None:
    safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    assert md(f"<p>{safe}</p>") == escaped


def test_line_start_is_escaped_after_a_break_and_in_list_items() -> None:
    assert md("<p>x<br>- y<br>2. z</p>") == "x  \n\\- y  \n2\\. z"
    assert md("<ul><li>- y</li><li>1. z</li></ul>") == "- \\- y\n- 1\\. z"
    # In the middle of a line these characters are plain.
    assert md("<p>a - b # c + d 1. e</p>") == "a - b # c + d 1. e"


def test_tilde_and_ampersand_are_escaped_in_text_but_not_in_code() -> None:
    assert md("<p>~x~ and ~~y~~</p>") == r"\~x\~ and \~\~y\~\~"
    # A literal "&lt;" typed in the page (written &amp;lt; in the source) stays text.
    assert md("<p>R&amp;D and &amp;lt; and &amp;#35;</p>") == r"R\&D and \&lt; and \&#35;"
    page = "<p><code>~a &amp; b~</code></p><pre>~a &amp; b~</pre>"
    assert md(page) == "`~a & b~`\n\n```\n~a & b~\n```"
    assert md("<h2>A &amp; B ~</h2>") == r"## A \& B \~"


def test_heading_text_cannot_end_in_a_closing_sequence() -> None:
    assert md("<h2>C #</h2>") == "## C \\#"


def test_pipes_are_escaped_only_in_table_cells() -> None:
    assert md("<p>a|b</p>") == "a|b"
    assert md("<table><tr><td>a|b</td></tr></table>") == "| a\\|b |\n| --- |"


# --- design 2: dropped ---------------------------------------------------------------------------


# Scenario: Script and style are left out
def test_script_style_and_a_javascript_link_are_left_out() -> None:
    page = (
        "<html><head><title>Title text</title><style>body{color:red}</style></head><body>"
        "<script>alert('xss')</script><style>p{margin:0}</style>"
        "<p>Visible <a href='javascript:alert(2)'>click</a></p></body></html>"
    )
    markdown = extract_html(page).markdown
    assert markdown == "Visible click"


@pytest.mark.parametrize(
    "tag",
    [
        "script",
        "style",
        "noscript",
        "template",
        "svg",
        "nav",
        "iframe",
        "object",
        "embed",
        "form",
        "button",
        "select",
        "textarea",
        "audio",
        "video",
        "canvas",
    ],
)
def test_dropped_tags_lose_their_content(tag: str) -> None:
    assert md(f"<p>keep</p><{tag}>secret <b>text</b></{tag}><p>end</p>") == "keep\n\nend"
    # A <form> closes the paragraph it is in; the others sit inside the line.
    separator = "\n\n" if tag == "form" else " "
    assert md(f"<p>a <{tag}>secret</{tag}>b</p>") == f"a{separator}b"


def test_void_dropped_tags_and_comments_are_left_out() -> None:
    assert md("<p>a<img src='x.png' alt='alt text'>b<input value='v'></p>") == "ab"
    assert md("<p>a<!-- hidden comment -->b</p>") == "ab"
    page = "<!DOCTYPE html><!-- top --><html><body><p>x</p></body></html>"
    assert extract_html(page).markdown == "x"


def test_navigation_links_do_not_reach_the_lesson() -> None:
    page = "<nav><a href='https://x.test'>Home</a><ul><li>Menu</li></ul></nav><h1>Page</h1>"
    assert md(page) == "# Page"


def test_a_fragment_without_body_still_converts() -> None:
    assert extract_html("<h2>Only</h2><p>fragment</p>").markdown == "## Only\n\nfragment"


# --- design 6: limits and messages ---------------------------------------------------------------


# Scenario: HTML page without text
@pytest.mark.parametrize(
    "page",
    [
        "",
        "   ",
        "<html><head><title>T</title></head><body></body></html>",
        "<body><script>x()</script><img src='a.png'><p> </p></body>",
    ],
)
def test_a_page_without_text_warns(page: str) -> None:
    result = extract_html(page)
    assert result.markdown == ""
    assert result.truncated is False
    assert result.warning == "the page has no text to import"


def test_a_normal_page_has_no_warning() -> None:
    result = extract_html("<p>text</p>")
    assert (result.truncated, result.warning) == (False, None)


# Scenario: Long page
def test_a_long_page_is_cut_on_a_line_boundary() -> None:
    page = (
        "<body>" + "".join(f"<p>paragraph {i:05d} {'x' * 90}</p>" for i in range(2000)) + "</body>"
    )
    result = extract_html(page)
    assert result.truncated is True
    assert result.warning == "only the first part was imported (at most 100,000 characters)"
    assert 0 < len(result.markdown) <= MAX_CHARS
    assert "paragraph 00000" in result.markdown and "paragraph 01999" not in result.markdown
    # Whole paragraphs only: every line is a complete paragraph.
    assert all(line.endswith("x" * 90) for line in result.markdown.split("\n\n"))


def test_a_page_of_exactly_the_limit_is_not_cut() -> None:
    result = extract_html(f"<p>{'a' * MAX_CHARS}</p>")
    assert len(result.markdown) == MAX_CHARS
    assert result.truncated is False and result.warning is None


def test_very_deep_nesting_does_not_crash() -> None:
    depth = 600
    page = "<body>" + "<div>" * depth + "deep text" + "</div>" * depth + "</body>"
    assert "deep text" in extract_html(page).markdown
    nested = "<ul>" + "<li>x" * 300 + "</li></ul>" * 1
    assert "x" in extract_html(nested).markdown
    spans = "<p>" + "<b>" * 500 + "bold text" + "</b>" * 500 + "</p>"
    assert "bold text" in extract_html(spans).markdown


# --- the API -------------------------------------------------------------------------------------


def upload(client: TestClient, data: bytes, name: str, type_: str = "text/html") -> object:
    return client.post("/api/lessons/extract-file", files={"file": (name, data, type_)})


# Scenario: Import an HTML page and save (the API part)
def test_api_converts_an_html_page_and_stores_nothing(client: TestClient) -> None:
    page = (
        b"<html><body><h1>Kafka</h1><p>A log.</p><ul><li>topic</li></ul>"
        b"<table><tr><th>A</th></tr><tr><td>1</td></tr></table></body></html>"
    )
    response = upload(client, page, "kafka.html")
    assert response.status_code == 200, response.text  # type: ignore[attr-defined]
    assert response.json() == {  # type: ignore[attr-defined]
        "markdown": "# Kafka\n\nA log.\n\n- topic\n\n| A |\n| --- |\n| 1 |",
        "pages": None,
        "truncated": False,
        "warning": None,
    }
    assert client.get("/api/lessons/devops/helm").json()["body"] == ""


@pytest.mark.parametrize("name", ["PAGE.HTM", "page.Html", "a.b.html"])
def test_html_is_recognised_by_the_name_in_any_case(client: TestClient, name: str) -> None:
    response = upload(client, b"<p>hello</p>", name, "application/octet-stream")
    assert response.status_code == 200  # type: ignore[attr-defined]
    assert response.json()["markdown"] == "hello"  # type: ignore[attr-defined]


# Scenario: Code and diagrams
def test_api_code_and_script_cases(client: TestClient) -> None:
    page = (
        b"<pre>a\n  b</pre><p>use <code>x</code></p><script>evil()</script>"
        b"<p><a href='javascript:evil()'>link</a> *not bold* # not a heading</p>"
    )
    markdown = upload(client, page, "p.html").json()["markdown"]  # type: ignore[attr-defined]
    assert markdown == ("```\na\n  b\n```\n\nuse `x`\n\nlink \\*not bold\\* # not a heading")
    assert "evil" not in markdown


# Scenario: HTML page without text
def test_api_page_without_text(client: TestClient) -> None:
    body = upload(client, b"<html><body><script>x</script></body></html>", "e.html").json()  # type: ignore[attr-defined]
    assert body["markdown"] == "" and body["pages"] is None
    assert body["warning"] == "the page has no text to import"


# Scenario: Undecodable HTML
def test_api_undecodable_html_is_refused(client: TestClient) -> None:
    response = upload(client, b"<p>caf\xe9</p>", "latin.html")
    assert response.status_code == 422  # type: ignore[attr-defined]
    assert response.json()["detail"] == (  # type: ignore[attr-defined]
        "not decodable as UTF-8 or as its declared charset"
    )


def test_api_declared_charset_is_used(client: TestClient) -> None:
    page = b'<meta charset="iso-8859-1"><p>caf\xe9</p>'
    assert upload(client, page, "latin.html").json()["markdown"] == "café"  # type: ignore[attr-defined]


# Scenario: Long page
def test_api_long_page_is_cut(client: TestClient) -> None:
    page = "".join(f"<p>paragraph {i:05d} {'x' * 90}</p>" for i in range(2000)).encode()
    body = upload(client, page, "long.html").json()  # type: ignore[attr-defined]
    assert body["truncated"] is True
    assert body["warning"] == "only the first part was imported (at most 100,000 characters)"
    assert len(body["markdown"]) <= MAX_CHARS


def test_api_pdf_goes_through_the_pdf_import(client: TestClient) -> None:
    response = upload(client, make_pdf([[b"Helm charts", b"values"]]), "a.pdf", "application/pdf")
    assert response.status_code == 200  # type: ignore[attr-defined]
    body = response.json()  # type: ignore[attr-defined]
    assert body["pages"] == 1 and "Helm charts" in body["markdown"]


# Scenario: Not a PDF
@pytest.mark.parametrize("name", ["notes.txt", "notes", "page.html.txt", "doc.docx"])
def test_api_other_files_are_refused_as_not_a_pdf(client: TestClient, name: str) -> None:
    response = upload(client, b"<p>hello</p>", name, "text/plain")
    assert response.status_code == 422  # type: ignore[attr-defined]
    assert response.json()["detail"] == "the file is not a PDF"  # type: ignore[attr-defined]


def test_api_pdf_problems_keep_their_messages(client: TestClient) -> None:
    encrypted = upload(client, make_pdf([[b"x"]], encrypted=True), "a.pdf", "application/pdf")
    assert encrypted.status_code == 422  # type: ignore[attr-defined]
    assert "password" in encrypted.json()["detail"]  # type: ignore[attr-defined]
    scanned = upload(client, make_pdf([[]]), "scan.pdf", "application/pdf").json()  # type: ignore[attr-defined]
    assert scanned["markdown"] == "" and "no text to import" in scanned["warning"]


def test_api_oversized_upload_is_refused_for_html_and_pdf(client: TestClient) -> None:
    limit = client.app.state.settings.max_upload_bytes  # type: ignore[attr-defined]
    mb = limit // (1024 * 1024)
    for name in ("big.html", "big.pdf"):
        response = upload(client, b"<p>" + b"0" * limit, name)
        assert response.status_code == 422  # type: ignore[attr-defined]
        assert response.json()["detail"] == f"the file is larger than {mb} MB"  # type: ignore[attr-defined]


def test_api_needs_the_app_header(client: TestClient) -> None:
    response = client.post(
        "/api/lessons/extract-file",
        files={"file": ("a.html", b"<p>x</p>", "text/html")},
        headers={"X-LearningHub": "0"},
    )
    assert response.status_code == 403


def test_api_needs_a_session(settings_factory: Callable[..., Settings]) -> None:
    app = create_app(settings_factory(auth_required=True))
    files = {"file": ("a.html", b"<p>x</p>", "text/html")}
    with TestClient(app, headers={"X-LearningHub": "1"}) as anonymous:
        assert anonymous.post("/api/lessons/extract-file", files=files).status_code == 401
    with signed_in_client(app, headers={"X-LearningHub": "1"}) as signed:
        assert signed.post("/api/lessons/extract-file", files=files).status_code == 200
    app.state.engine.dispose()


def test_extract_pdf_route_is_unchanged(client: TestClient) -> None:
    response = client.post(
        "/api/lessons/extract-pdf", files={"file": ("a.html", b"<p>x</p>", "text/html")}
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "the file is not a PDF"
