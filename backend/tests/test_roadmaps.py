"""Spec: roadmap-catalog."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import REPO_ROOT
from app.main import create_app
from app.roadmaps import RoadmapCatalog, RoadmapError, load_domain

SHIPPED = REPO_ROOT / "roadmaps"


def write(tmp_path: Path, name: str, text: str) -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


SHIPPED_ORDER = ["frontend", "backend", "devops", "qa", "data-engineer"]


# Scenario: Roadmap files are loaded at startup
def test_shipped_roadmaps_load_in_explicit_order() -> None:
    catalog = RoadmapCatalog.load(SHIPPED)
    assert [d.id for d in catalog.domains()] == SHIPPED_ORDER


# Scenario: Initial roadmap content
@pytest.mark.parametrize("domain_id", SHIPPED_ORDER)
def test_shipped_roadmaps_have_15_to_25_nodes(domain_id: str) -> None:
    domain = RoadmapCatalog.load(SHIPPED).domain(domain_id)
    assert domain is not None
    assert 15 <= len(domain.nodes) <= 25
    assert domain.description


# Scenario: Domain description is optional
def test_domain_without_description_or_order(tmp_path: Path) -> None:
    write(tmp_path, "b.yaml", "{id: b, title: B, nodes: [{id: x, title: X}]}")
    write(
        tmp_path,
        "a.yaml",
        "{id: a, title: A, order: 2, description: ' First. ', nodes: [{id: x, title: X}]}",
    )
    write(tmp_path, "c.yaml", "{id: c, title: C, order: 1, nodes: [{id: x, title: X}]}")
    catalog = RoadmapCatalog.load(tmp_path)
    assert [d.id for d in catalog.domains()] == ["c", "a", "b"]
    assert catalog.domain("b").description is None
    assert catalog.domain("a").description == "First."


def test_domain_order_must_be_an_integer(tmp_path: Path) -> None:
    path = write(tmp_path, "a.yaml", "{id: a, title: A, order: first, nodes: [{id: x, title: X}]}")
    with pytest.raises(RoadmapError, match=r"a\.yaml.*order must be an integer"):
        load_domain(path)


# Scenario: Full node id
def test_full_node_id_joins_domain_and_node() -> None:
    node = RoadmapCatalog.load(SHIPPED).node("backend/caching")
    assert node is not None
    assert node.full_id == "backend/caching"


def test_sibling_order_follows_file_order(tmp_path: Path) -> None:
    path = write(
        tmp_path,
        "d.yaml",
        "id: d\ntitle: D\nnodes:\n"
        "  - {id: a, title: A}\n  - {id: b, title: B}\n"
        "  - {id: c, title: C, parent: a}\n  - {id: e, title: E, parent: a}\n",
    )
    nodes = {n.id: n for n in load_domain(path).nodes}
    assert (nodes["a"].order, nodes["b"].order) == (0, 1)
    assert (nodes["c"].order, nodes["e"].order) == (0, 1)


# Requirement: Invalid roadmap files stop startup with a clear error
INVALID = [
    ("unparsable", "id: d\ntitle: [unclosed\n", ["invalid YAML"]),
    ("missing domain id", "title: D\nnodes:\n  - {id: a, title: A}\n", ["missing domain id"]),
    ("missing node id", "id: d\ntitle: D\nnodes:\n  - {title: A}\n", ["node #1 has no id"]),
    ("missing title", "id: d\ntitle: D\nnodes:\n  - {id: a}\n", ["'a' has no title"]),
    (
        "duplicate",
        "id: d\ntitle: D\nnodes:\n  - {id: caching, title: A}\n  - {id: caching, title: B}\n",
        ["duplicate node id 'caching'"],
    ),
    ("not kebab", "id: d\ntitle: D\nnodes:\n  - {id: Redis_Cache, title: A}\n", ["Redis_Cache"]),
    (
        "unknown parent",
        "id: d\ntitle: D\nnodes:\n  - {id: docker, title: A, parent: containers}\n",
        ["'docker'", "unknown parent 'containers'"],
    ),
    (
        "cycle",
        "id: d\ntitle: D\nnodes:\n"
        "  - {id: a, title: A, parent: b}\n  - {id: b, title: B, parent: a}\n",
        ["parent cycle"],
    ),
]


@pytest.mark.parametrize(("case", "text", "expected"), INVALID, ids=[c[0] for c in INVALID])
def test_invalid_roadmap_names_file_and_node(
    tmp_path: Path, case: str, text: str, expected: list[str]
) -> None:
    write(tmp_path, "broken.yaml", text)
    with pytest.raises(RoadmapError) as error:
        RoadmapCatalog.load(tmp_path)
    message = str(error.value)
    assert message.startswith("broken.yaml:")
    for part in expected:
        assert part in message


# Scenario: Duplicate node id / Unknown parent -> startup fails
def test_app_refuses_to_start_with_invalid_roadmap(tmp_path: Path, settings_factory) -> None:
    write(
        tmp_path,
        "backend.yaml",
        "id: backend\ntitle: B\nnodes:\n  - {id: a, title: A}\n  - {id: a, title: A2}\n",
    )
    with pytest.raises(RoadmapError, match=r"backend\.yaml.*duplicate node id 'a'"):
        create_app(settings_factory(roadmaps_dir=tmp_path))


# Requirement: Clients can list domains and read a roadmap
def test_list_domains(client: TestClient) -> None:
    response = client.get("/api/domains")
    assert response.status_code == 200
    body = {d["id"]: d for d in response.json()}
    assert [d["id"] for d in response.json()] == SHIPPED_ORDER
    assert body["backend"]["title"] == "Backend"
    assert body["backend"]["description"].startswith("Server-side code -")
    assert body["backend"]["learned_nodes"] == 0
    assert body["backend"]["node_count"] == len(
        RoadmapCatalog.load(SHIPPED).domain("backend").nodes
    )


def test_read_roadmap(client: TestClient) -> None:
    response = client.get("/api/domains/backend/roadmap")
    assert response.status_code == 200
    nodes = {n["id"]: n for n in response.json()["nodes"]}
    redis = nodes["redis"]
    assert redis == {
        "id": "redis",
        "full_id": "backend/redis",
        "title": "Redis",
        "description": "Data structures, eviction, TTL.",
        "parent": "caching",
        "order": 0,
    }


def test_unknown_domain_is_404(client: TestClient) -> None:
    assert client.get("/api/domains/mobile/roadmap").status_code == 404
