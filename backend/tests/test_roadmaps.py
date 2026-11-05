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


# Scenario: Roadmap files are loaded at startup
def test_shipped_roadmaps_load_backend_and_devops() -> None:
    catalog = RoadmapCatalog.load(SHIPPED)
    assert {d.id for d in catalog.domains()} == {"backend", "devops"}


# Scenario: Initial roadmap content
@pytest.mark.parametrize("domain_id", ["backend", "devops"])
def test_shipped_roadmaps_have_15_to_25_nodes(domain_id: str) -> None:
    domain = RoadmapCatalog.load(SHIPPED).domain(domain_id)
    assert domain is not None
    assert 15 <= len(domain.nodes) <= 25


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
    assert set(body) == {"backend", "devops"}
    assert body["backend"]["title"] == "Backend"
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
    assert client.get("/api/domains/frontend/roadmap").status_code == 404
