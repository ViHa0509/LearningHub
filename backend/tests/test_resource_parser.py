"""Spec: node-resources - Sync resource links (only link lines are parsed; synthetic fixture)."""

from pathlib import Path

from app.resources.parser import ParsedLink, parse_links

FIXTURE = Path(__file__).parent / "fixtures" / "resources" / "synthetic-node.md"


def test_parses_only_link_lines_in_order() -> None:
    links = parse_links(FIXTURE.read_text(encoding="utf-8"))
    assert links == [
        ParsedLink("official", "Synthetic Spec Home", "https://example.test/spec"),
        ParsedLink("article", "An Example Article", "https://example.test/articles/one?x=1"),
        ParsedLink("video", "Example Video Talk", "https://example.test/video/42"),
        ParsedLink("open-source", "Example Repo", "https://example.test/repo"),
        # An empty label falls back to the URL.
        ParsedLink("article", "https://example.test/untitled", "https://example.test/untitled"),
        ParsedLink("feed", "Example Community", "https://example.test/community"),
    ]


def test_description_text_is_never_kept() -> None:
    links = parse_links(FIXTURE.read_text(encoding="utf-8"))
    kept = " ".join(f"{link.type} {link.label} {link.url}" for link in links)
    assert "description" not in kept
    assert "plain-prose" not in kept  # a prose link is not a resource line
    assert "ftp://" not in kept  # only http(s)


def test_empty_or_linkless_text() -> None:
    assert parse_links("") == []
    assert parse_links("# Title\n\nJust words, [a link](https://example.test/x).") == []
