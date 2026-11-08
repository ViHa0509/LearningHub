"""Links of one roadmap.sh node file. Only link lines are read; descriptions are never kept."""

import re
from dataclasses import dataclass

LINK = re.compile(r"\[@(\w[\w-]*)@([^\]]*)\]\((https?://[^)\s]+)\)")


@dataclass(frozen=True)
class ParsedLink:
    type: str
    label: str
    url: str


def parse_links(markdown: str) -> list[ParsedLink]:
    """Every ``[@type@label](url)`` in the file, in order; everything else is ignored."""
    links: list[ParsedLink] = []
    for match in LINK.finditer(markdown):
        kind, label, url = match.groups()
        label = " ".join(label.split())
        links.append(ParsedLink(type=kind.lower(), label=label or url, url=url))
    return links
