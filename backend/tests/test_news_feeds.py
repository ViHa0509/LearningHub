"""Spec: ai-news - feed parsing (RSS 2.0, Atom, no DTD or entities, plain-text summary)."""

from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.news.feeds import ELLIPSIS, FeedError, parse_feed, plain_text, shorten

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)

RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Synthetic</title>
  <item>
    <title>Robots &amp; &lt;b&gt;people&lt;/b&gt;</title>
    <link>https://example.test/robots</link>
    <pubDate>Fri, 06 Nov 2026 09:30:00 -0500</pubDate>
    <description><![CDATA[<p>Hello <b>world</b></p><script>alert(1)</script><style>p{}</style>
      more   text]]></description>
    <guid>https://example.test/robots</guid>
  </item>
  <item>
    <title>Guid only</title>
    <guid isPermaLink="true">https://example.test/guid</guid>
    <dc:date>2026-11-05T10:00:00Z</dc:date>
  </item>
  <item><title>Not a permalink</title><guid isPermaLink="false">abc-123</guid></item>
  <item><title>Script link</title><link>javascript:alert(1)</link></item>
  <item><title>No date</title><link>http://example.test/no-date</link></item>
  <item><title>Bad date</title><link>https://example.test/bad</link><pubDate>soon</pubDate></item>
  <item><title>Future</title><link>https://example.test/f</link>
    <pubDate>Sat, 01 Jan 2050 00:00:00 GMT</pubDate></item>
</channel>
</rss>
"""

ATOM = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Synthetic Atom</title>
  <entry>
    <title type="html">Atom &lt;i&gt;one&lt;/i&gt;</title>
    <link rel="self" href="https://example.test/self"/>
    <link rel="alternate" href="https://example.test/atom-one"/>
    <updated>2026-11-07T08:00:00+02:00</updated>
    <published>2026-11-06T08:00:00+02:00</published>
    <summary type="html">&lt;p&gt;Summary &lt;em&gt;one&lt;/em&gt;&lt;/p&gt;</summary>
  </entry>
  <entry>
    <title>Atom two</title>
    <link href="https://example.test/atom-two"/>
    <updated>2026-11-04T08:00:00</updated>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">Body <b>two</b>
      <script>steal()</script></div></content>
  </entry>
  <entry><title>No link</title><updated>2026-11-04T08:00:00Z</updated></entry>
</feed>
"""


def test_rss_items() -> None:
    items = parse_feed(RSS, NOW)
    assert [i.url for i in items] == [
        "https://example.test/robots",
        "https://example.test/guid",
        "http://example.test/no-date",
        "https://example.test/bad",
        "https://example.test/f",
    ]
    first = items[0]
    assert first.title == "Robots & people"
    assert first.published_at == datetime(2026, 11, 6, 14, 30, tzinfo=UTC)
    assert first.published_at.tzinfo is not None
    assert items[1].published_at == datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
    assert items[1].summary == ""
    # Missing, invalid or future dates become the fetch time.
    assert [i.published_at for i in items[2:]] == [NOW, NOW, NOW]


# Scenario: Summary is plain text
def test_summary_is_plain_text_without_script() -> None:
    summary = parse_feed(RSS, NOW)[0].summary
    assert summary == "Hello world more text"
    assert "<" not in summary and "alert" not in summary and "p{}" not in summary


def test_atom_entries() -> None:
    items = parse_feed(ATOM, NOW)
    assert [i.url for i in items] == [
        "https://example.test/atom-one",
        "https://example.test/atom-two",
    ]
    one, two = items
    assert one.title == "Atom one"
    assert one.summary == "Summary one"
    assert one.published_at == datetime(2026, 11, 6, 6, 0, tzinfo=UTC)
    assert two.published_at == datetime(2026, 11, 4, 8, 0, tzinfo=UTC)
    assert two.summary == "Body two"


def test_long_summary_is_cut_at_a_word_boundary() -> None:
    words = " ".join(f"word{n}" for n in range(200))
    feed = RSS.replace("<p>Hello <b>world</b></p>", f"<p>{words}</p>")
    summary = parse_feed(feed, NOW)[0].summary
    assert len(summary) <= 400 and summary.endswith(ELLIPSIS)
    assert summary[:-1].split(" ")[-1].startswith("word")
    assert words.startswith(summary[:-1])
    assert shorten("short") == "short"
    assert len(shorten("x" * 1000)) == 400


@pytest.mark.parametrize(
    "doc",
    [
        '<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x "boom">]><rss><channel/></rss>',
        "<?xml version='1.0'?><!doctype rss SYSTEM 'http://example.test/x.dtd'><rss/>",
        "<rss><channel><item><title><!ENTITY a 'b'></title></item></channel></rss>",
    ],
)
def test_dtd_or_entities_are_refused(doc: str) -> None:
    with pytest.raises(FeedError, match="declares a DTD or entities"):
        parse_feed(doc, NOW)


@pytest.mark.parametrize(
    ("doc", "reason"),
    [
        ("not xml at all", "not valid XML"),
        ("<html><body/></html>", "not an RSS 2.0 or Atom feed"),
        ("<rss version='2.0'/>", "no channel"),
    ],
)
def test_other_documents_are_refused(doc: str, reason: str) -> None:
    with pytest.raises(FeedError, match=reason):
        parse_feed(doc, NOW)


def test_encoding_declaration_in_decoded_text() -> None:
    doc = (
        '<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><item>'
        "<title>Café</title><link>https://example.test/c</link></item></channel></rss>"
    )
    assert parse_feed(doc, NOW)[0].title == "Café"


def test_naive_dates_are_utc_and_offsets_are_kept() -> None:
    feed = RSS.replace("Fri, 06 Nov 2026 09:30:00 -0500", "2026-11-06T09:30:00")
    published = parse_feed(feed, NOW)[0].published_at
    assert published == datetime(2026, 11, 6, 9, 30, tzinfo=UTC)
    offset = timezone(timedelta(hours=-5))
    assert parse_feed(RSS, NOW)[0].published_at == datetime(2026, 11, 6, 9, 30, tzinfo=offset)


def test_plain_text_helper() -> None:
    assert plain_text(None) == ""
    assert plain_text("  a \n b ") == "a b"
    assert plain_text("<noscript>x</noscript><p>y</p>") == "y"
