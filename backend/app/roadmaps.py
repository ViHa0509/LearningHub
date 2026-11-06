"""Hand-written roadmaps: loading, validation and lookup.

Roadmaps live only in YAML files (one per domain) and are held in memory;
notes refer to nodes by their full id, ``<domain>/<node>``.
"""

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

KEBAB = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


class RoadmapError(Exception):
    """A roadmap file is invalid. The message names the file and the offending node."""


@dataclass(frozen=True)
class Node:
    domain: str
    id: str
    title: str
    description: str | None
    parent: str | None
    order: int

    @property
    def full_id(self) -> str:
        return f"{self.domain}/{self.id}"


@dataclass(frozen=True)
class Domain:
    id: str
    title: str
    nodes: tuple[Node, ...]
    description: str | None = None
    order: int | None = None


def _fail(path: Path, message: str) -> RoadmapError:
    return RoadmapError(f"{path.name}: {message}")


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def load_domain(path: Path) -> Domain:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise _fail(path, f"invalid YAML ({exc})") from exc
    if not isinstance(data, dict):
        raise _fail(path, "top level must be a mapping with id, title and nodes")

    domain_id = _text(data.get("id"))
    domain_title = _text(data.get("title"))
    if domain_id is None:
        raise _fail(path, "missing domain id")
    if not KEBAB.match(domain_id):
        raise _fail(path, f"domain id '{domain_id}' is not lowercase kebab-case")
    if domain_title is None:
        raise _fail(path, f"domain '{domain_id}' has no title")
    domain_order = data.get("order")
    if domain_order is not None and (
        not isinstance(domain_order, int) or isinstance(domain_order, bool)
    ):
        raise _fail(path, f"domain '{domain_id}' order must be an integer")
    raw_nodes = data.get("nodes")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        raise _fail(path, f"domain '{domain_id}' has no nodes")

    seen: dict[str, dict[str, object]] = {}
    for index, raw in enumerate(raw_nodes):
        if not isinstance(raw, dict):
            raise _fail(path, f"node #{index + 1} is not a mapping")
        node_id = _text(raw.get("id"))
        if node_id is None:
            raise _fail(path, f"node #{index + 1} has no id")
        if not KEBAB.match(node_id):
            raise _fail(path, f"node '{node_id}' id is not lowercase kebab-case")
        if node_id in seen:
            raise _fail(path, f"duplicate node id '{node_id}'")
        if _text(raw.get("title")) is None:
            raise _fail(path, f"node '{node_id}' has no title")
        seen[node_id] = raw

    sibling_count: dict[str | None, int] = {}
    nodes: list[Node] = []
    for node_id, raw in seen.items():
        parent = _text(raw.get("parent"))
        if parent is not None and parent not in seen:
            raise _fail(path, f"node '{node_id}' has unknown parent '{parent}'")
        order = sibling_count.get(parent, 0)
        sibling_count[parent] = order + 1
        nodes.append(
            Node(
                domain=domain_id,
                id=node_id,
                title=str(_text(raw.get("title"))),
                description=_text(raw.get("description")),
                parent=parent,
                order=order,
            )
        )

    parents = {node.id: node.parent for node in nodes}
    for node in nodes:
        visited = {node.id}
        current = node.parent
        while current is not None:
            if current in visited:
                raise _fail(path, f"node '{node.id}' is part of a parent cycle")
            visited.add(current)
            current = parents[current]

    return Domain(
        id=domain_id,
        title=domain_title,
        nodes=tuple(nodes),
        description=_text(data.get("description")),
        order=domain_order,
    )


class RoadmapCatalog:
    def __init__(self, domains: list[Domain]) -> None:
        self._domains = {domain.id: domain for domain in domains}
        self._nodes = {node.full_id: node for domain in domains for node in domain.nodes}

    @classmethod
    def load(cls, directory: Path) -> "RoadmapCatalog":
        files = sorted(directory.glob("*.yaml"))
        if not files:
            raise RoadmapError(f"no roadmap files (*.yaml) in {directory}")
        domains: list[Domain] = []
        for path in files:
            domain = load_domain(path)
            if any(existing.id == domain.id for existing in domains):
                raise _fail(path, f"duplicate domain id '{domain.id}'")
            domains.append(domain)
        # Explicit `order` first, then file name order for domains without one.
        domains.sort(key=lambda d: (d.order is None, d.order or 0))
        return cls(domains)

    def domains(self) -> list[Domain]:
        return list(self._domains.values())

    def domain(self, domain_id: str) -> Domain | None:
        return self._domains.get(domain_id)

    def node(self, full_id: str) -> Node | None:
        return self._nodes.get(full_id)

    def has_node(self, full_id: str) -> bool:
        return full_id in self._nodes
