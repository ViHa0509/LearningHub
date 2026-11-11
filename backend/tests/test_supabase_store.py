"""Spec: delivery - Note files in Supabase Storage (mock transport, no network)."""

import json
import logging
from collections.abc import Callable
from typing import Any

import httpx2
import pytest

from app.config import Settings
from app.main import build_store, create_app
from app.storage import StorageError, SupabaseFileStore
from tests.agent_fakes import NoNetworkFactory, fake_resolver
from tests.conftest import signed_in_client

URL = "https://proj.supabase.co"
SERVICE_KEY = "service-key-SECRET-0123456789"
KEY = "blobs/ab/" + "ab" * 32 + ".html"
BASE = f"{URL}/storage/v1/object/learninghub"
PREFIX = "/storage/v1/object/learninghub"


class FakeSupabase:
    """A bucket in memory behind a MockTransport; records every request."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.requests: list[httpx2.Request] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        path = request.url.path
        if request.method == "POST" and path.startswith(PREFIX + "/"):
            self.objects[path.removeprefix(PREFIX + "/")] = request.content
            return httpx2.Response(200, json={"Key": "ok"})
        if request.method == "GET" and path.startswith(PREFIX + "/"):
            found = self.objects.get(path.removeprefix(PREFIX + "/"))
            if found is None:
                return httpx2.Response(404, json={"error": "not_found"})
            return httpx2.Response(200, content=found)
        if request.method == "DELETE" and path == PREFIX:
            for gone in json.loads(request.content)["prefixes"]:
                self.objects.pop(gone, None)
            return httpx2.Response(200, json=[])
        return httpx2.Response(500)

    def store(self) -> SupabaseFileStore:
        return SupabaseFileStore(
            URL, SERVICE_KEY, "learninghub", transport=httpx2.MockTransport(self)
        )


def store_with(handler: Callable[[httpx2.Request], httpx2.Response]) -> SupabaseFileStore:
    return SupabaseFileStore(
        URL, SERVICE_KEY, "learninghub", transport=httpx2.MockTransport(handler)
    )


def test_put_posts_the_bytes_with_the_service_key_and_upsert() -> None:
    fake = FakeSupabase()
    fake.store().put(KEY, b"<html>x</html>")
    [request] = fake.requests
    assert request.method == "POST"
    assert str(request.url) == f"{BASE}/{KEY}"
    assert request.headers["authorization"] == f"Bearer {SERVICE_KEY}"
    assert request.headers["apikey"] == SERVICE_KEY
    assert request.headers["x-upsert"] == "true"
    assert request.headers["content-type"] == "application/octet-stream"
    assert request.content == b"<html>x</html>"


def test_get_returns_the_bytes_and_sends_the_key() -> None:
    fake = FakeSupabase()
    store = fake.store()
    store.put(KEY, b"data")
    assert store.get(KEY) == b"data"
    request = fake.requests[-1]
    assert (request.method, str(request.url)) == ("GET", f"{BASE}/{KEY}")
    assert request.headers["authorization"] == f"Bearer {SERVICE_KEY}"
    assert request.headers["apikey"] == SERVICE_KEY


def test_get_of_a_missing_key_is_file_not_found() -> None:
    with pytest.raises(FileNotFoundError):
        FakeSupabase().store().get(KEY)


def test_delete_sends_the_prefixes_body_and_a_missing_key_is_fine() -> None:
    fake = FakeSupabase()
    store = fake.store()
    store.put(KEY, b"data")
    store.delete(KEY)
    request = fake.requests[-1]
    assert (request.method, str(request.url)) == ("DELETE", BASE)
    assert json.loads(request.content) == {"prefixes": [KEY]}
    assert request.headers["authorization"] == f"Bearer {SERVICE_KEY}"
    assert KEY not in fake.objects
    store.delete(KEY)  # already gone: no error


def test_errors_do_not_carry_the_response_body_or_the_key(
    caplog: pytest.LogCaptureFixture,
) -> None:
    body = {"message": f"secret detail {SERVICE_KEY}"}
    store = store_with(lambda request: httpx2.Response(403, json=body))
    caplog.set_level(logging.DEBUG)
    for action in (lambda: store.put(KEY, b"x"), lambda: store.get(KEY), lambda: store.delete(KEY)):
        with pytest.raises(StorageError) as raised:
            action()
        text = str(raised.value)
        assert "403" in text and "secret detail" not in text and SERVICE_KEY not in text
    assert SERVICE_KEY not in caplog.text
    assert SERVICE_KEY not in repr(store)


def test_a_network_failure_is_a_storage_error_without_details() -> None:
    def broken(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError(f"cannot reach {request.url} with {SERVICE_KEY}")

    with pytest.raises(StorageError) as raised:
        store_with(broken).get(KEY)
    assert SERVICE_KEY not in str(raised.value)


@pytest.mark.parametrize(
    "bad", ["", "/abs", "../x", "a/../b", "a//b", "a\\b", "C:/x", "./a", "blobs/ab/.."]
)
def test_bad_keys_are_refused_before_any_request(bad: str) -> None:
    fake = FakeSupabase()
    store = fake.store()
    for action in (lambda: store.put(bad, b"x"), lambda: store.get(bad), lambda: store.delete(bad)):
        with pytest.raises(ValueError):
            action()
    assert fake.requests == []


def test_the_client_uses_a_30_second_timeout_and_no_redirects() -> None:
    client = FakeSupabase().store()._client
    assert client.timeout.read == 30.0
    assert client.follow_redirects is False


# Scenario: Missing setting
@pytest.mark.parametrize(
    ("overrides", "named"),
    [
        ({"supabase_url": None}, "LH_SUPABASE_URL"),
        ({"supabase_service_key": None}, "LH_SUPABASE_SERVICE_KEY"),
        ({"supabase_bucket": " "}, "LH_SUPABASE_BUCKET"),
    ],
)
def test_startup_refuses_a_supabase_backend_with_a_missing_setting(
    settings_factory: Callable[..., Settings], overrides: dict[str, Any], named: str
) -> None:
    values: dict[str, Any] = {
        "storage_backend": "supabase",
        "supabase_url": URL,
        "supabase_service_key": SERVICE_KEY,
    }
    values.update(overrides)
    with pytest.raises(RuntimeError, match=named) as raised:
        create_app(settings_factory(**values))
    assert SERVICE_KEY not in str(raised.value)


def test_the_default_backend_is_local(settings: Settings) -> None:
    assert settings.storage_backend == "local"
    assert type(build_store(settings)).__name__ == "LocalFileStore"


# Scenario: Import and open a note on Render
def test_import_and_open_a_note_through_the_supabase_store(
    settings_factory: Callable[..., Settings],
) -> None:
    fake = FakeSupabase()
    app = create_app(
        settings_factory(
            storage_backend="supabase", supabase_url=URL, supabase_service_key=SERVICE_KEY
        )
    )
    assert isinstance(app.state.store, SupabaseFileStore)
    app.state.store = fake.store()  # the same class, over the in-memory bucket
    app.state.url_resolver = fake_resolver()
    app.state.llm_factory = NoNetworkFactory()
    page = b"<html><head><title>Cloud note</title></head><body>hello cloud</body></html>"
    with signed_in_client(app, headers={"X-LearningHub": "1"}) as client:
        imported = client.post(
            "/api/notes/import", files=[("files", ("cloud.html", page, "text/html"))]
        )
        assert imported.status_code == 200, imported.text
        note = imported.json()["results"][0]["note"]
        assert len(fake.objects) == 1
        original = client.get(f"/api/notes/{note['id']}/original")
        assert original.status_code == 200
        assert original.content == page
        assert original.headers["content-security-policy"] == "sandbox allow-scripts"
        assert SERVICE_KEY not in json.dumps(imported.json())
    app.state.engine.dispose()


def test_a_missing_object_answered_as_400_with_status_404_is_not_found() -> None:
    """Supabase Storage answers some missing objects with HTTP 400 and statusCode "404"."""
    body = {"statusCode": "404", "error": "not_found", "message": "Object not found"}
    store = store_with(lambda request: httpx2.Response(400, json=body))
    with pytest.raises(FileNotFoundError):
        store.get("blobs/ab/missing.html")
    store.delete("blobs/ab/missing.html")  # missing is fine on delete


def test_another_400_is_a_storage_error() -> None:
    store = store_with(lambda request: httpx2.Response(400, json={"statusCode": "400"}))
    with pytest.raises(StorageError):
        store.get("blobs/ab/x.html")


def test_a_missing_bucket_is_a_storage_error_that_says_so() -> None:
    body = {"statusCode": "404", "error": "Bucket not found", "message": "Bucket not found"}
    store = store_with(lambda request: httpx2.Response(400, json=body))
    for action in (lambda: store.get(KEY), lambda: store.put(KEY, b"x"), lambda: store.delete(KEY)):
        with pytest.raises(StorageError, match="the bucket does not exist"):
            action()


def test_a_refused_service_key_is_named() -> None:
    body = {"statusCode": "403", "error": "Unauthorized", "message": "invalid signature"}
    store = store_with(lambda request: httpx2.Response(400, json=body))
    with pytest.raises(StorageError, match="the service key was refused") as raised:
        store.put(KEY, b"x")
    assert "invalid signature" not in str(raised.value)


def test_a_storage_error_answers_502_with_the_reason(settings: Settings) -> None:
    app = create_app(settings)
    app.state.store = FakeSupabase().store()
    app.state.url_resolver = fake_resolver()
    app.state.llm_factory = NoNetworkFactory()
    page = b"<html><head><title>Kept</title></head><body>x</body></html>"
    with signed_in_client(app, headers={"X-LearningHub": "1"}) as client:
        imported = client.post(
            "/api/notes/import", files=[("files", ("k.html", page, "text/html"))]
        )
        note = imported.json()["results"][0]["note"]
        app.state.store = store_with(
            lambda request: httpx2.Response(
                400, json={"statusCode": "404", "error": "Bucket not found"}
            )
        )
        answer = client.get(f"/api/notes/{note['id']}/original")
    app.state.engine.dispose()
    assert answer.status_code == 502
    assert answer.json()["detail"] == (
        "File storage: storage read failed (HTTP 400): the bucket does not exist"
    )
