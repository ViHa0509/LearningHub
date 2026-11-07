"""Model presets per provider type, from ``app/agent/model_catalog.yaml``."""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

CATALOG_FILE = Path(__file__).resolve().parents[1] / "model_catalog.yaml"


@dataclass(frozen=True)
class ModelPreset:
    id: str
    context_window: int | None = None
    max_output: int | None = None


def load_catalog(path: Path = CATALOG_FILE) -> dict[str, tuple[ModelPreset, ...]]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a mapping of provider type to models")
    catalog: dict[str, tuple[ModelPreset, ...]] = {}
    for provider_type, models in data.items():
        if not isinstance(models, list):
            raise ValueError(f"{path}: '{provider_type}' must be a list of models")
        catalog[str(provider_type)] = tuple(
            ModelPreset(
                id=str(m["id"]),
                context_window=m.get("context_window"),
                max_output=m.get("max_output"),
            )
            for m in models
        )
    return catalog


@lru_cache
def catalog() -> dict[str, tuple[ModelPreset, ...]]:
    return load_catalog()


def presets(provider_type: str) -> tuple[ModelPreset, ...]:
    return catalog().get(provider_type, ())


def default_model(provider_type: str) -> str | None:
    models = presets(provider_type)
    return models[0].id if models else None


def preset(provider_type: str, model: str) -> ModelPreset | None:
    return next((m for m in presets(provider_type) if m.id == model), None)
