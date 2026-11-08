"""Spec: node-resources - Resource mapping per domain."""

import shutil
from collections.abc import Callable
from pathlib import Path

import pytest

from app.config import REPO_ROOT, Settings
from app.main import create_app
from app.resources.mapping import ResourceRef, load_mappings
from app.roadmaps import RoadmapCatalog, RoadmapError

SHIPPED = REPO_ROOT / "roadmaps"


def roadmaps_with(tmp_path: Path, mapping: str) -> Path:
    directory = tmp_path / "roadmaps"
    (directory / "sources").mkdir(parents=True)
    shutil.copy(SHIPPED / "frontend.yaml", directory / "frontend.yaml")
    (directory / "sources" / "frontend.yaml").write_text(mapping, encoding="utf-8")
    return directory


VALID = """\
domain: frontend
source: roadmap.sh
commit: abc1234
nodes:
  html:
    - frontend/html
    - html/*
  css:
    - css/box-model
"""


def test_shipped_mapping_matches_the_catalog() -> None:
    catalog = RoadmapCatalog.load(SHIPPED)
    mappings = load_mappings(SHIPPED, catalog)
    assert "frontend" in mappings
    assert all(catalog.has_node(node) for node in mappings["frontend"].nodes)


def test_mapping_is_loaded_on_startup(
    tmp_path: Path, settings_factory: Callable[..., Settings]
) -> None:
    app = create_app(settings_factory(roadmaps_dir=roadmaps_with(tmp_path, VALID)))
    mapping = app.state.resource_mappings["frontend"]
    assert mapping.commit == "abc1234"
    assert mapping.nodes == {
        "frontend/html": (ResourceRef("frontend", "html"), ResourceRef("html", "*")),
        "frontend/css": (ResourceRef("css", "box-model"),),
    }
    assert mapping.source_url("frontend/css") == "https://roadmap.sh/css"
    assert mapping.source_url("frontend/react") == "https://roadmap.sh/frontend"
    app.state.engine.dispose()


# Scenario: Unknown app node
def test_unknown_app_node_stops_the_server(
    tmp_path: Path, settings_factory: Callable[..., Settings]
) -> None:
    text = VALID.replace("  css:\n", "  not-a-node:\n")
    with pytest.raises(RoadmapError, match="unknown node 'frontend/not-a-node'"):
        create_app(settings_factory(roadmaps_dir=roadmaps_with(tmp_path, text)))


@pytest.mark.parametrize(
    ("text", "message"),
    [
        (VALID.replace("domain: frontend", "domain: nowhere"), "unknown domain 'nowhere'"),
        (VALID.replace("css/box-model", "CSS/Box Model"), "invalid reference 'CSS/Box Model'"),
        (VALID.replace("css/box-model", "css/box/model"), "invalid reference 'css/box/model'"),
        (VALID.replace("commit: abc1234", "commit: main"), "commit 'main'"),
        (VALID.replace("source: roadmap.sh", "source: other"), "unknown source 'other'"),
        ("- just a list\n", "top level must be a mapping"),
    ],
)
def test_invalid_mapping_names_the_problem(tmp_path: Path, text: str, message: str) -> None:
    directory = roadmaps_with(tmp_path, text)
    with pytest.raises(RoadmapError, match=message) as error:
        load_mappings(directory, RoadmapCatalog.load(directory))
    assert "sources/frontend.yaml" in str(error.value)


def test_no_sources_folder_means_no_mappings(tmp_path: Path) -> None:
    shutil.copy(SHIPPED / "frontend.yaml", tmp_path / "frontend.yaml")
    assert load_mappings(tmp_path, RoadmapCatalog.load(tmp_path)) == {}
