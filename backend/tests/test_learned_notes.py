"""Spec: agent-chat - the assistant saves new topics as learned notes (save_learned_note)."""

import io
import json
import re
import zipfile
from typing import Any

from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

from app.agent.messages import ToolCall, Turn
from app.agent.tools import AgentTools
from app.notes_page import build_note_page
from tests.agent_fakes import FakeModel
from tests.conftest import TEST_DATABASE_URL, alembic_config, user_id_of
from tests.test_agent_chat import chat, import_note, use
from tests.test_data_backup import download, restore, rewrite
from tests.test_learning_fields import aws

WRITE_UP = (
    "Short intro.\n\n## Overview\nRPC over HTTP/2.\n\n## Key ideas\n- Protobuf\n\n"
    "> [!KEY] Contracts first\n\n## Key takeaways\n- Fast\n- Typed\n"
)


def save(**args: Any) -> Turn:
    return Turn(text="", tool_calls=[ToolCall(id="s1", name="save_learned_note", input=args)])


def notes(client: TestClient) -> list[dict[str, Any]]:
    return list(client.get("/api/notes").json())


def page_of(client: TestClient, note_id: str) -> str:
    response = client.get(f"/api/notes/{note_id}/original")
    assert response.status_code == 200
    return response.text


def ask(client: TestClient, *turns: Turn, text: str = "explain gRPC") -> Any:
    use(client, *turns, Turn(text="done"))
    response = chat(client, text)
    assert response.status_code == 200, response.text
    return response.json()


def tool_answer(model: FakeModel) -> str:
    """What the model was told by its first tool call."""
    return str(model.calls[1]["messages"][-1].text)


# Scenario: New topic
def test_new_topic_is_saved_as_an_agent_note_and_named_in_the_answer(client: TestClient) -> None:
    body = ask(client, save(title="gRPC", markdown=WRITE_UP, node_id="backend/apis"))
    [item] = notes(client)
    assert item["title"] == "gRPC"
    assert item["source"] == "agent"
    assert item["node_id"] == "backend/apis"
    assert item["node_missing"] is False
    assert body["changed_notes"] == [item["id"]]
    step = body["steps"][0]
    assert step["tool"] == "save_learned_note" and "gRPC" in step["summary"]
    page = page_of(client, item["id"])
    assert page.startswith("<!DOCTYPE html>") and "<h2" in page and "takeaways" in page
    assert "prefers-color-scheme:dark" in page and "callout key" in page
    detail = client.get(f"/api/notes/{item['id']}").json()
    assert "Protobuf" in detail["body_text"]
    found = client.get("/api/notes", params={"node": "backend/apis"}).json()
    assert [n["id"] for n in found] == [item["id"]]


def test_the_tool_result_gives_the_id_and_title(client: TestClient) -> None:
    model = use(client, save(title="gRPC", markdown=WRITE_UP), Turn(text="done"))
    assert chat(client, "explain gRPC").status_code == 200
    result = json.loads(tool_answer(model))
    assert result["saved"] is True and result["title"] == "gRPC"
    assert result["id"] == notes(client)[0]["id"]


def test_without_a_node_the_note_is_unsorted(client: TestClient) -> None:
    ask(client, save(title="gRPC", markdown=WRITE_UP))
    [item] = notes(client)
    assert item["node_id"] is None
    assert client.get("/api/notes", params={"unsorted": True}).json()[0]["id"] == item["id"]


def test_the_node_may_belong_to_a_users_own_area(client: TestClient) -> None:
    aws(client)
    ask(client, save(title="IAM basics", markdown=WRITE_UP, node_id="aws/iam"))
    assert notes(client)[0]["node_id"] == "aws/iam"


def test_an_unknown_node_is_refused(client: TestClient) -> None:
    model = use(client, save(title="gRPC", markdown=WRITE_UP, node_id="nope/none"), Turn(text="ok"))
    body = chat(client, "explain gRPC").json()
    assert notes(client) == [] and body["changed_notes"] == []
    assert "unknown node 'nope/none'" in tool_answer(model)


# Scenario: Already known
def test_same_title_is_refused_case_insensitively(client: TestClient) -> None:
    import_note(client, "gRPC", "an imported page")
    model = use(client, save(title="GRPC", markdown=WRITE_UP), Turn(text="from the note"))
    body = chat(client, "explain gRPC again").json()
    assert [n["source"] for n in notes(client)] == ["import"]
    assert body["changed_notes"] == []
    assert "a note titled 'GRPC' already exists" in tool_answer(model)
    assert body["steps"][0]["summary"].startswith("Error: a note titled")


def test_saving_twice_adds_one_note(client: TestClient) -> None:
    use(
        client,
        save(title="gRPC", markdown=WRITE_UP),
        Turn(text="done"),
        save(title="gRPC", markdown=WRITE_UP + "\nMore."),
        Turn(text="done again"),
    )
    assert chat(client, "explain gRPC").json()["changed_notes"] != []
    assert chat(client, "explain gRPC").json()["changed_notes"] == []
    assert len(notes(client)) == 1


def test_a_node_with_a_note_is_refused(client: TestClient) -> None:
    import_note(client, "Caching", "text")
    note_id = notes(client)[0]["id"]
    client.patch(f"/api/notes/{note_id}", json={"node_id": "backend/caching"})
    model = use(
        client, save(title="Redis", markdown=WRITE_UP, node_id="backend/caching"), Turn(text="ok")
    )
    assert chat(client, "explain Redis").status_code == 200
    assert len(notes(client)) == 1
    assert "backend/caching already has notes or a lesson" in tool_answer(model)


def test_a_node_with_a_lesson_is_refused(client: TestClient) -> None:
    client.put("/api/lessons/backend/caching", json={"body": "my own lesson"})
    model = use(
        client, save(title="Redis", markdown=WRITE_UP, node_id="backend/caching"), Turn(text="ok")
    )
    assert chat(client, "explain Redis").status_code == 200
    assert notes(client) == []
    assert "already has notes or a lesson" in tool_answer(model)


def test_other_users_notes_and_lessons_are_not_considered(
    client: TestClient, second_client: TestClient
) -> None:
    import_note(second_client, "gRPC", "theirs")
    second_client.put("/api/lessons/backend/apis", json={"body": "theirs"})
    ask(client, save(title="gRPC", markdown=WRITE_UP, node_id="backend/apis"))
    [mine] = notes(client)
    assert mine["title"] == "gRPC" and mine["node_id"] == "backend/apis"
    assert [n["source"] for n in notes(second_client)] == ["import"]


# Scenario: HTML in the write-up
def test_script_in_the_markdown_is_shown_as_text(client: TestClient) -> None:
    ask(
        client,
        save(
            title="<script>alert(1)</script> title",
            markdown=(
                "Intro <img src=x onerror=alert(2)>\n\n## Overview\n"
                "<script>alert(3)</script>\n\n"
                "```html\n<script>x</script>\n```\n\n"
                "[a](javascript:alert(4)) [b](https://e.test)\n\n"
                "![i](https://e.test/p.png)\n"
            ),
        ),
    )
    page = page_of(client, notes(client)[0]["id"])
    assert "<script" not in page.lower()
    assert "<img" not in page.lower()
    assert "&lt;script&gt;alert(3)&lt;/script&gt;" in page
    assert 'href="javascript:' not in page
    assert 'rel="noopener noreferrer"' in page and 'href="https://e.test"' in page


def test_page_builder_structure() -> None:
    page = build_note_page("T", WRITE_UP)
    assert page.count("<section") == 3 and 'data-n="3"' in page
    assert 'class="card takeaways"' in page
    assert '<aside class="callout key">' in page and "Key idea" in page
    assert "[!KEY]" not in page and "</aside>" in page
    assert "<blockquote" not in page
    assert re.search(r"<title>T</title>", page)


# Tool availability and limits
def test_only_the_assistant_is_offered_the_tool(client: TestClient) -> None:
    with client.app.state.session_factory() as session:  # type: ignore[attr-defined]
        catalog = client.app.state.catalog  # type: ignore[attr-defined]
        uid = user_id_of(client.app)
        for agent, offered in (("assistant", True), ("lesson-writer", False), ("outline", False)):
            tools = AgentTools(session, catalog, user_id=uid, agent_id=agent)
            assert ("save_learned_note" in {s.name for s in tools.specs()}) is offered
            if not offered:
                outcome = tools.run("save_learned_note", {"title": "x", "markdown": "y"})
                assert "unknown tool" in outcome.result


def test_empty_title_or_too_long_text_is_an_error(client: TestClient) -> None:
    with client.app.state.session_factory() as session:  # type: ignore[attr-defined]
        tools = AgentTools(
            session,
            client.app.state.catalog,  # type: ignore[attr-defined]
            user_id=user_id_of(client.app),
            store=client.app.state.store,  # type: ignore[attr-defined]
        )
        empty = tools.run("save_learned_note", {"title": " ", "markdown": "x"})
        assert "'title' must be a non-empty string" in empty.result
        long = tools.run("save_learned_note", {"title": "T", "markdown": "x" * 20_001})
        assert "longer than" in long.result
    assert notes(client) == []


def test_agent_note_can_be_renamed_moved_archived_and_deleted(client: TestClient) -> None:
    ask(client, save(title="gRPC", markdown=WRITE_UP))
    note_id = notes(client)[0]["id"]
    assert client.patch(f"/api/notes/{note_id}", json={"title": "gRPC 101"}).status_code == 200
    moved = client.patch(f"/api/notes/{note_id}", json={"node_id": "backend/apis"})
    assert moved.status_code == 200
    assert client.patch(f"/api/notes/{note_id}", json={"archived": True}).status_code == 200
    assert client.delete(f"/api/notes/{note_id}").status_code == 204


def test_the_assistant_is_told_when_to_save(client: TestClient) -> None:
    model = use(client, Turn(text="hi"))
    chat(client, "hello")
    assert "save_learned_note" in model.calls[0]["system"]
    assert "save_learned_note" in {t.name for t in model.calls[0]["tools"]}


def test_a_saved_note_comes_back_in_the_note_json(client: TestClient) -> None:
    ask(client, save(title="gRPC", markdown=WRITE_UP))
    note_id = notes(client)[0]["id"]
    assert client.get(f"/api/notes/{note_id}").json()["source"] == "agent"
    import_note(client, "Other", "x")
    assert sorted(n["source"] for n in notes(client)) == ["agent", "import"]


# Migration and backup
def test_0016_adds_source_with_default_import_and_downgrade_removes_it() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    user = "00000000-0000-0000-0000-000000000001"
    try:
        command.upgrade(config, "head")
        command.downgrade(config, "0015")
        assert "source" not in {c["name"] for c in inspect(engine).get_columns("notes")}
        with engine.begin() as connection:
            connection.execute(
                text(f"INSERT INTO users (id, email, role) VALUES ('{user}', 'p@x.test', 'admin')")
            )
            connection.execute(
                text(
                    "INSERT INTO notes (id, user_id, title, body_text, original_name, size_bytes, "
                    "content_sha256, storage_key) VALUES "
                    f"('00000000-0000-0000-0000-0000000000a1', '{user}', 'Old', 'b', 'o.html', 1, "
                    "'s', 'k')"
                )
            )
        command.upgrade(config, "head")
        columns = {c["name"]: c for c in inspect(engine).get_columns("notes")}
        assert columns["source"]["nullable"] is False
        with engine.begin() as connection:
            assert connection.execute(text("SELECT source FROM notes")).scalar() == "import"
            connection.execute(text("DELETE FROM users"))
    finally:
        command.upgrade(config, "head")
        engine.dispose()


def test_backup_and_restore_keep_the_source(client: TestClient) -> None:
    import_note(client, "Imported", "x")
    ask(client, save(title="gRPC", markdown=WRITE_UP, node_id="backend/apis"))
    expected = {"Imported": "import", "gRPC": "agent"}
    data = download(client)
    archive = zipfile.ZipFile(io.BytesIO(data))
    rows = json.loads(archive.read("data/notes.json"))
    assert {r["title"]: r["source"] for r in rows} == expected
    for n in notes(client):
        client.patch(f"/api/notes/{n['id']}", json={"archived": True})
        client.delete(f"/api/notes/{n['id']}")
    assert notes(client) == []
    assert restore(client, data).status_code == 200
    assert {n["title"]: n["source"] for n in notes(client)} == expected


def test_an_archive_without_source_restores_as_import(client: TestClient) -> None:
    import_note(client, "Old one", "x")
    data = download(client)

    def strip(entries: dict[str, bytes]) -> None:
        rows = json.loads(entries["data/notes.json"])
        for row in rows:
            row.pop("source", None)
        entries["data/notes.json"] = json.dumps(rows).encode()

    assert restore(client, rewrite(data, strip)).status_code == 200
    assert [n["source"] for n in notes(client)] == ["import"]
