"""Spec: ai-providers - error categories, parameter rules per type, SSRF checks, catalog."""

from typing import Any

import anthropic
import openai
import pytest

from app.agent.llm import catalog
from app.agent.llm.errors import RECOVERABLE, classify_anthropic, classify_openai
from app.agent.llm.params import PROVIDER_TYPES, clean_config, validate_config
from app.agent.llm.urls import PRIVATE_ONLY_FOR_LOCAL, validate_base_url
from tests.agent_fakes import connection_error, fake_resolver, status_error, timeout_error

# --- errors -------------------------------------------------------------------------

CASES: list[tuple[Any, str]] = [
    (lambda sdk: status_error(sdk, "AuthenticationError", 401, "invalid x-api-key"), "auth_failed"),
    (lambda sdk: status_error(sdk, "PermissionDeniedError", 403), "auth_failed"),
    (lambda sdk: status_error(sdk, "NotFoundError", 404, "model not found"), "invalid_model"),
    (
        lambda sdk: status_error(sdk, "BadRequestError", 400, "The model `x` does not exist"),
        "invalid_model",
    ),
    (
        lambda sdk: status_error(sdk, "BadRequestError", 400, "temperature too high"),
        "invalid_config",
    ),
    (lambda sdk: status_error(sdk, "RateLimitError", 429), "rate_limited"),
    (timeout_error, "timeout"),
    (connection_error, "unavailable"),
    (lambda sdk: status_error(sdk, "InternalServerError", 503), "unavailable"),
    (lambda sdk: status_error(sdk, "UnprocessableEntityError", 422), "invalid_config"),
]


@pytest.mark.parametrize(("make", "category"), CASES)
@pytest.mark.parametrize(
    ("sdk", "classify"), [(anthropic, classify_anthropic), (openai, classify_openai)]
)
def test_each_error_category(make: Any, category: str, sdk: Any, classify: Any) -> None:
    error = classify(make(sdk))
    assert error.category == category
    assert str(error)
    assert error.recoverable == (category in {"timeout", "rate_limited", "unavailable"})


def test_auth_error_keeps_the_provider_message() -> None:
    error = classify_openai(status_error(openai, "AuthenticationError", 401, "Incorrect API key"))
    assert "Incorrect API key" in str(error)
    assert frozenset({"timeout", "rate_limited", "unavailable"}) == RECOVERABLE


# --- parameters ---------------------------------------------------------------------


def fields(provider_type: str, config: Any) -> dict[str, str]:
    return {e.field: e.msg for e in validate_config(provider_type, config)}


@pytest.mark.parametrize(
    ("name", "bad", "good"),
    [
        ("temperature", 3, 2),
        ("temperature", -0.1, 0),
        ("top_p", 1.5, 1),
        ("max_tokens", 0, 1),
        ("max_tokens", 200_001, 200_000),
        ("max_tokens", 10.5, 10),
        ("timeout", 0, 1),
        ("timeout", 601, 600),
    ],
)
def test_ranges(name: str, bad: Any, good: Any) -> None:
    for provider_type in PROVIDER_TYPES:
        assert name in fields(provider_type, {name: bad}), (provider_type, name, bad)
        assert fields(provider_type, {name: good}) == {}


def test_out_of_range_names_the_field() -> None:
    assert fields("openai", {"temperature": 3}) == {"temperature": "must be between 0 and 2"}
    assert fields("openai", {"temperature": True}) == {"temperature": "must be a number"}
    assert fields("openai", {"temperature": "hot"}) == {"temperature": "must be a number"}


# Scenario: Unsupported parameter
@pytest.mark.parametrize(
    "name", ["frequency_penalty", "presence_penalty", "seed", "response_format"]
)
def test_anthropic_refuses_openai_only_parameters(name: str) -> None:
    value = "json" if name == "response_format" else 1
    assert fields("anthropic", {name: value}) == {name: f"{name} is not supported by Anthropic"}


def test_openai_like_types_refuse_top_k_and_accept_their_parameters() -> None:
    full = {
        "temperature": 0.2,
        "max_tokens": 100,
        "top_p": 0.9,
        "timeout": 30,
        "frequency_penalty": 0.5,
        "presence_penalty": -0.5,
        "stop": ["END"],
        "seed": 7,
        "response_format": "json",
        "context_window": 8000,
        "extra": {"reasoning_effort": "low"},
    }
    for provider_type in ("openai", "gemini", "local", "custom"):
        assert fields(provider_type, full) == {}
        assert "top_k" in fields(provider_type, {"top_k": 5})
    assert fields("anthropic", {"top_k": 5, "stop": ["x"], "extra": {}}) == {}


def test_other_parameter_rules() -> None:
    assert "nonsense" in fields("openai", {"nonsense": 1})
    assert "stop" in fields("openai", {"stop": "END"})
    assert "stop" in fields("openai", {"stop": [""]})
    assert "response_format" in fields("openai", {"response_format": "xml"})
    assert "extra" in fields("openai", {"extra": [1]})
    assert fields("openai", "not an object") == {"config": "must be an object"}
    assert fields("openai", {"temperature": None}) == {}
    assert clean_config({"temperature": None, "max_tokens": 100.0, "top_p": 0.5}) == {
        "max_tokens": 100,
        "top_p": 0.5,
    }


def test_type_table() -> None:
    assert set(PROVIDER_TYPES) == {"openai", "anthropic", "gemini", "local", "custom"}
    assert [t for t, i in PROVIDER_TYPES.items() if i.needs_key] == [
        "openai",
        "anthropic",
        "gemini",
    ]
    assert [t for t, i in PROVIDER_TYPES.items() if i.needs_base_url] == ["local", "custom"]
    assert PROVIDER_TYPES["gemini"].default_base_url == (
        "https://generativelanguage.googleapis.com/v1beta/openai/"
    )


# --- SSRF -----------------------------------------------------------------------------

RESOLVE_TABLE = {
    "api.example.com": "93.184.216.34",
    "localhost": "127.0.0.1",
    "internal.example.com": "10.0.0.5",
    "loop.example.com": "127.0.0.1",
    "v6loop.example.com": "::1",
    "mapped.example.com": "::ffff:127.0.0.1",
}
RESOLVE = fake_resolver(RESOLVE_TABLE)


@pytest.mark.parametrize(
    "url",
    [
        "https://api.example.com/v1",
        "https://203.0.113.0.example.com/v1",
        "https://api.deepseek.com",
        "https://8.8.8.8/v1",
    ],
)
def test_ssrf_accepts_public_https(url: str) -> None:
    assert validate_base_url("custom", url, RESOLVE) == url


# Scenario: Metadata address
@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/v1",
        "https://169.254.169.254/latest",
        "https://127.0.0.1/v1",
        "https://10.1.2.3/v1",
        "https://192.168.1.10/v1",
        "https://[::1]/v1",
        "https://[fe80::1]/v1",
        "https://0.0.0.0/v1",
        "https://224.0.0.1/v1",
        "https://240.0.0.1/v1",
        "https://internal.example.com/v1",
        "https://loop.example.com/v1",
        "https://v6loop.example.com/v1",
        "https://mapped.example.com/v1",
        "https://localhost/v1",
    ],
)
def test_ssrf_rejects_private_addresses_for_other_types(url: str) -> None:
    with pytest.raises(ValueError, match=PRIVATE_ONLY_FOR_LOCAL):
        validate_base_url("custom", url, RESOLVE)


@pytest.mark.parametrize(
    ("url", "message"),
    [
        ("ftp://api.example.com/v1", "http:// or https://"),
        ("api.example.com/v1", "http:// or https://"),
        ("https://user:pw@api.example.com/v1", "user name or password"),
        ("https:///v1", "no host"),
        ("http://api.example.com/v1", "must use https"),
        ("https://unresolvable.invalid/v1", "cannot be resolved"),
        ("https://api.example.com:99999/v1", "not valid"),
    ],
)
def test_ssrf_rejects_bad_urls(url: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        validate_base_url("openai", url, RESOLVE)


# Scenario: Local server
@pytest.mark.parametrize(
    "url", ["http://localhost:11434/v1", "http://127.0.0.1:8002/v1", "http://192.168.1.20/v1"]
)
def test_local_may_point_at_private_addresses(url: str) -> None:
    def no_dns(*_: Any) -> Any:
        raise AssertionError("local URLs need no lookup")

    assert validate_base_url("local", url, no_dns) == url


def test_local_still_refuses_credentials_and_other_schemes() -> None:
    with pytest.raises(ValueError, match="user name"):
        validate_base_url("local", "http://a:b@localhost/v1", RESOLVE)
    with pytest.raises(ValueError, match="http://"):
        validate_base_url("local", "file:///etc/passwd", RESOLVE)


def test_vendor_default_url_needs_no_lookup() -> None:
    def no_dns(*_: Any) -> Any:
        raise AssertionError("no lookup expected")

    url = PROVIDER_TYPES["openai"].default_base_url
    assert url is not None
    assert validate_base_url("openai", url, no_dns) == url


# --- catalog ----------------------------------------------------------------------------


def test_catalog_has_presets_per_type() -> None:
    assert catalog.default_model("anthropic") == "claude-sonnet-5-5"
    assert {m.id for m in catalog.presets("anthropic")} >= {"claude-haiku-5-5", "claude-opus-5-5"}
    assert catalog.presets("local")
    assert catalog.presets("nonsense") == ()
    sonnet = catalog.preset("anthropic", "claude-sonnet-5-5")
    assert sonnet is not None and sonnet.context_window == 200000
