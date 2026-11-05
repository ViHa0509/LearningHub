"""Spec: knowledge-import - Extract title and readable text."""

from pathlib import Path

import pytest

from app.extract import UndecodableError, decode_html, extract

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> str:
    return decode_html((FIXTURES / name).read_bytes())


# Scenario: Title from the title tag
def test_title_from_title_tag() -> None:
    assert extract(load("redis-eviction.html"), "redis-eviction.html").title == (
        "Redis eviction policies"
    )


# Scenario: No title tag
def test_title_falls_back_to_first_h1() -> None:
    assert extract(load("jwt-no-title.html"), "jwt-no-title.html").title == "JWT vs sessions"


def test_title_falls_back_to_filename_without_extension() -> None:
    assert extract("<html><body><p>hi</p></body></html>", "k8s-hpa.html").title == "k8s-hpa"


def test_empty_title_tag_is_ignored() -> None:
    html = "<html><head><title>  </title></head><body><h1>Heading</h1></body></html>"
    assert extract(html, "x.html").title == "Heading"


# Scenario: Scripts are not text
def test_scripts_and_styles_are_not_text() -> None:
    text = extract(load("redis-eviction.html"), "redis-eviction.html").text
    assert "allkeys-lru" in text
    assert "shortest TTL first" in text
    assert "this-should-not-be-text" not in text
    assert "font-family" not in text
    assert "new Chart" not in text


def test_noscript_and_template_are_not_text() -> None:
    text = extract(load("jwt-no-title.html"), "jwt-no-title.html").text
    assert "Stateless tokens trade revocation for scale." in text
    assert "Enable JavaScript" not in text
    assert "template-only-text" not in text


def test_whitespace_is_collapsed() -> None:
    text = extract("<body><p>a\n\n   b</p>\t<p>c</p></body>", "x.html").text
    assert text == "a b c"


def test_decode_utf8_with_bom() -> None:
    assert decode_html("﻿<p>é</p>".encode()) == "<p>é</p>"


def test_decode_falls_back_to_declared_charset() -> None:
    data = '<meta charset="windows-1252"><p>café</p>'.encode("cp1252")
    assert "café" in decode_html(data)


def test_undecodable_bytes_are_rejected() -> None:
    with pytest.raises(UndecodableError):
        decode_html(b"\xff\xfe\x00\x81\x9d binary")
