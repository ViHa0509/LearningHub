"""Provider types and the parameters each supports, with validation of a configuration.

A configuration's ``config`` holds only the parameters the user set; an absent key means
"not set", and only set, supported parameters are sent to the provider.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

ProviderType = str  # one of PROVIDER_TYPES


@dataclass(frozen=True)
class TypeInfo:
    type: str
    label: str
    needs_key: bool
    needs_base_url: bool
    default_base_url: str | None
    params: tuple[str, ...]
    capabilities: tuple[str, ...]
    # Settings that are not model parameters (not listed in ``params``).
    settings: tuple[str, ...] = ()
    allows_extra: bool = True
    allows_base_url: bool = True
    # The only kind of key accepted (a prefix), or None for any key.
    key_prefix: str | None = None


# Parameters every type accepts (not sent as model parameters except max_tokens and so on).
COMMON = ("temperature", "max_tokens", "top_p", "timeout", "context_window")
ANTHROPIC_PARAMS = (*COMMON, "top_k", "stop")
OPENAI_PARAMS = (
    *COMMON,
    "frequency_penalty",
    "presence_penalty",
    "stop",
    "seed",
    "response_format",
)
OPENAI_CAPABILITIES = ("chat", "tool calling", "JSON response format", "seed")

PROVIDER_TYPES: dict[str, TypeInfo] = {
    "openai": TypeInfo(
        "openai",
        "OpenAI",
        needs_key=True,
        needs_base_url=False,
        default_base_url="https://api.openai.com/v1",
        params=OPENAI_PARAMS,
        capabilities=OPENAI_CAPABILITIES,
    ),
    "anthropic": TypeInfo(
        "anthropic",
        "Anthropic",
        needs_key=True,
        needs_base_url=False,
        default_base_url="https://api.anthropic.com",
        params=ANTHROPIC_PARAMS,
        capabilities=("chat", "tool calling", "top k", "stop sequences"),
    ),
    "gemini": TypeInfo(
        "gemini",
        "Google Gemini",
        needs_key=True,
        needs_base_url=False,
        default_base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        params=OPENAI_PARAMS,
        capabilities=OPENAI_CAPABILITIES,
    ),
    "local": TypeInfo(
        "local",
        "Local",
        needs_key=False,
        needs_base_url=True,
        default_base_url="http://localhost:11434/v1",
        params=OPENAI_PARAMS,
        capabilities=("chat", "tool calling (model dependent)", "JSON response format", "seed"),
    ),
    "custom": TypeInfo(
        "custom",
        "Custom (OpenAI-compatible)",
        needs_key=False,
        needs_base_url=True,
        default_base_url=None,
        params=OPENAI_PARAMS,
        capabilities=OPENAI_CAPABILITIES,
    ),
    "claude-code": TypeInfo(
        "claude-code",
        "Claude Code (subscription)",
        needs_key=False,
        needs_base_url=False,
        default_base_url=None,
        params=("timeout",),
        capabilities=("chat", "tool calling (app tools over MCP)", "uses your Claude subscription"),
        settings=("claude_config_dir",),
        allows_extra=False,
        allows_base_url=False,
        key_prefix="sk-ant-oat",
    ),
}

ALL_PARAMS = frozenset(ANTHROPIC_PARAMS) | frozenset(OPENAI_PARAMS) | {"extra", "claude_config_dir"}
MAX_PATH = 500

# name -> (min, max, integer only)
RANGES: dict[str, tuple[float, float, bool]] = {
    "temperature": (0, 2, False),
    "top_p": (0, 1, False),
    "max_tokens": (1, 200_000, True),
    "timeout": (1, 600, False),
    "top_k": (1, 1000, True),
    "frequency_penalty": (-2, 2, False),
    "presence_penalty": (-2, 2, False),
    "seed": (-(2**63), 2**63 - 1, True),
    "context_window": (1, 10_000_000, True),
}
MAX_STOP = 8
MAX_STOP_LENGTH = 200


@dataclass(frozen=True)
class FieldError:
    field: str
    msg: str

    def as_dict(self) -> dict[str, str]:
        return {"field": self.field, "msg": self.msg}


def _number_error(name: str, value: Any) -> str | None:
    low, high, integer = RANGES[name]
    if isinstance(value, bool) or not isinstance(value, int | float):
        return "must be a number"
    if integer and not (isinstance(value, int) or float(value).is_integer()):
        return "must be a whole number"
    if not low <= value <= high:
        bounds = f"{low:g} and {high:g}" if name != "seed" else "the 64-bit range"
        return f"must be between {bounds}"
    return None


def validate_config(provider_type: str, config: Any) -> list[FieldError]:
    """Field errors for a parameter object of the given type (empty when valid)."""
    if not isinstance(config, dict):
        return [FieldError("config", "must be an object")]
    info = PROVIDER_TYPES.get(provider_type)
    errors: list[FieldError] = []
    for name, value in config.items():
        if value is None:
            continue
        if name not in ALL_PARAMS:
            errors.append(FieldError(name, f"unknown parameter '{name}'"))
            continue
        supported = (
            info is None
            or (name == "extra" and info.allows_extra)
            or name in info.params
            or name in info.settings
        )
        if not supported:
            label = info.label if info is not None else ""
            errors.append(FieldError(name, f"{name} is not supported by {label}"))
            continue
        message: str | None = None
        if name in RANGES:
            message = _number_error(name, value)
        elif name == "stop":
            if (
                not isinstance(value, list)
                or len(value) > MAX_STOP
                or not all(isinstance(s, str) and 0 < len(s) <= MAX_STOP_LENGTH for s in value)
            ):
                message = (
                    f"must be a list of at most {MAX_STOP} non-empty texts "
                    f"of up to {MAX_STOP_LENGTH} characters"
                )
        elif name == "response_format":
            if value not in ("text", "json"):
                message = "must be 'text' or 'json'"
        elif name == "extra" and not isinstance(value, dict):
            message = "must be a JSON object"
        elif name == "claude_config_dir":
            if not isinstance(value, str) or not 0 < len(value) <= MAX_PATH:
                message = f"must be a folder path of at most {MAX_PATH} characters"
            elif not Path(value).is_absolute() or not Path(value).is_dir():
                message = "must be an existing folder on this machine (an absolute path)"
        if message is not None:
            errors.append(FieldError(name, message))
    return errors


def clean_config(config: dict[str, Any]) -> dict[str, Any]:
    """The config without unset (None) values and with whole numbers stored as integers."""
    out: dict[str, Any] = {}
    for name, value in config.items():
        if value is None:
            continue
        if name in RANGES and RANGES[name][2] and isinstance(value, float):
            value = int(value)
        out[name] = value
    return out
