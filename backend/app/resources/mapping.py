"""Which roadmap.sh nodes feed each app node's References: ``roadmaps/sources/<domain>.yaml``.

A file maps app node ids of one domain to roadmap.sh references, ``<roadmap>/<slug>`` (every
``<slug>@*.md`` file of that roadmap) or ``<roadmap>/*`` (the whole roadmap), at a pinned commit.
Mappings are checked against the catalog at startup; an invalid one stops the server, like an
invalid roadmap file. Slugs are checked during a sync, against the tree at that commit.
"""

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from app.roadmaps import KEBAB, RoadmapCatalog, RoadmapError

REF = re.compile(r"^[a-z0-9-]+/([a-z0-9-]+|\*)$")
COMMIT = re.compile(r"^[0-9a-f]{7,40}$")
SOURCES_DIR = "sources"


@dataclass(frozen=True)
class ResourceRef:
    roadmap: str
    slug: str  # "*" means every node of the roadmap

    @classmethod
    def parse(cls, text: str) -> "ResourceRef":
        roadmap, _, slug = text.partition("/")
        return cls(roadmap=roadmap, slug=slug)

    def __str__(self) -> str:
        return f"{self.roadmap}/{self.slug}"


@dataclass(frozen=True)
class ResourceMapping:
    domain: str
    source: str
    commit: str
    # Full app node id -> references, in file order.
    nodes: dict[str, tuple[ResourceRef, ...]]

    def source_url(self, node_id: str) -> str:
        """The roadmap on roadmap.sh: the node's first mapped roadmap, else the domain."""
        refs = self.nodes.get(node_id)
        roadmap = refs[0].roadmap if refs else self.domain
        return f"https://roadmap.sh/{roadmap}"


def _fail(path: Path, message: str) -> RoadmapError:
    return RoadmapError(f"{SOURCES_DIR}/{path.name}: {message}")


def load_mapping(path: Path, catalog: RoadmapCatalog) -> ResourceMapping:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise _fail(path, f"invalid YAML ({exc})") from exc
    if not isinstance(data, dict):
        raise _fail(path, "top level must be a mapping with domain, source, commit and nodes")
    domain = data.get("domain")
    if not isinstance(domain, str) or catalog.domain(domain) is None:
        raise _fail(path, f"unknown domain '{domain}'")
    source = data.get("source")
    if source != "roadmap.sh":
        raise _fail(path, f"unknown source '{source}'")
    commit = str(data.get("commit") or "").strip()
    if not COMMIT.match(commit):
        raise _fail(path, f"commit '{commit}' is not a git commit id")
    raw_nodes = data.get("nodes")
    if not isinstance(raw_nodes, dict) or not raw_nodes:
        raise _fail(path, "nodes must be a mapping of app node ids to references")
    nodes: dict[str, tuple[ResourceRef, ...]] = {}
    for node, refs in raw_nodes.items():
        full_id = f"{domain}/{node}"
        if not isinstance(node, str) or not KEBAB.match(node) or not catalog.has_node(full_id):
            raise _fail(path, f"unknown node '{full_id}'")
        if not isinstance(refs, list) or not refs:
            raise _fail(path, f"node '{full_id}' has no references")
        parsed: list[ResourceRef] = []
        for ref in refs:
            if not isinstance(ref, str) or not REF.match(ref):
                raise _fail(path, f"node '{full_id}' has an invalid reference '{ref}'")
            parsed.append(ResourceRef.parse(ref))
        nodes[full_id] = tuple(parsed)
    return ResourceMapping(domain=domain, source=source, commit=commit, nodes=nodes)


def load_mappings(roadmaps_dir: Path, catalog: RoadmapCatalog) -> dict[str, ResourceMapping]:
    """Every mapping under ``<roadmaps_dir>/sources``, by domain; RoadmapError if one is invalid."""
    mappings: dict[str, ResourceMapping] = {}
    for path in sorted((roadmaps_dir / SOURCES_DIR).glob("*.yaml")):
        mapping = load_mapping(path, catalog)
        if mapping.domain in mappings:
            raise _fail(path, f"duplicate mapping for domain '{mapping.domain}'")
        mappings[mapping.domain] = mapping
    return mappings
