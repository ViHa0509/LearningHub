"""Spec: learning-views (Group unsorted notes with AI, Rename a category group) and agent-chat
(Note sorter agent, a saved note without a topic gets a category). No real provider is called."""

import json
from typing import Any

from fastapi.testclient import TestClient

from app.agent.agents import AGENTS
from app.agent.llm.errors import ProviderError
from app.agent.messages import Turn
from app.agent.resolve import utc_today
from app.agent.tools import ASSISTANT_SPECS
from tests.agent_fakes import FakeFactory
from tests.conftest import MEMBER_EMAIL
from tests.test_agent_chat import chat, import_note, use
from tests.test_learned_notes import WRITE_UP, save
from tests.test_shared_providers import add_shared, set_usage, status

RENAME = "/api/notes/categories/rename"


def answer(*groups: tuple[str, list[int]]) -> Turn:
    return Turn(text=json.dumps({"groups": [{"name": n, "notes": v} for n, v in groups]}))


def categories(client: TestClient) -> dict[str, str | None]:
    return {n["title"]: n["category"] for n in client.get("/api/notes").json()}


def five(client: TestClient) -> None:
    for title in ("n1", "n2", "n3", "n4", "n5"):  # n5 is the newest: number 1
        import_note(client, title, f"text of {title}")


# Scenario: Group with AI
def test_group_with_ai(client: TestClient) -> None:
    five(client)
    model = use(client, answer(("Kubernetes", [1, 2]), ("Career", [3, 4])))
    response = client.post("/api/notes/categorize")
    assert response.status_code == 200, response.text
    assert response.json() == {"grouped": 4, "groups": 2}
    assert categories(client) == {
        "n5": "Kubernetes",
        "n4": "Kubernetes",
        "n3": "Career",
        "n2": "Career",
        "n1": None,
    }
    [call] = model.calls
    assert call["tools"] == []
    prompt = call["messages"][0].text
    # The title is from the imported page too: it is inside the wrapper with the text.
    wrapped = "1.\n<untrusted_note_content>\nTitle: n5\ntext of n5\n</untrusted_note_content>"
    assert wrapped in prompt
    assert prompt.index("Title: n5") < prompt.index("Title: n1")


def test_rerun_regroups_and_reuses_existing_spelling(client: TestClient) -> None:
    five(client)
    use(client, answer(("Kubernetes", [1, 2])), answer(("kubernetes", [3]), ("Go", [1])))
    client.post("/api/notes/categorize")
    client.post("/api/notes/categorize")
    assert categories(client) == {
        "n5": "Go",
        "n4": None,
        "n3": "Kubernetes",
        "n2": None,
        "n1": None,
    }


# Scenario: Unreadable answer
def test_unreadable_answer_changes_nothing(client: TestClient) -> None:
    five(client)
    use(client, Turn(text="sorry"), Turn(text='{"groups": "x"}'))
    for _ in range(2):
        response = client.post("/api/notes/categorize")
        assert response.status_code == 502
        assert response.json()["detail"] == "The note sorter answered in an unexpected format"
    assert set(categories(client).values()) == {None}


def test_unknown_and_repeated_numbers_and_bad_names_are_ignored(client: TestClient) -> None:
    five(client)
    text = "Here: " + json.dumps(
        {
            "groups": [
                {"name": "  Cloud   Ops ", "notes": [1, 1, 9, 0, "2", True]},
                {"name": "Other", "notes": [1, 2]},
                {"name": "x" * 41, "notes": [3]},
                {"name": "", "notes": [4]},
            ]
        }
    )
    use(client, Turn(text=text))
    assert client.post("/api/notes/categorize").json() == {"grouped": 2, "groups": 2}
    result = categories(client)
    assert (result["n5"], result["n4"], result["n3"]) == ("Cloud Ops", "Other", None)


def test_at_most_twelve_groups(client: TestClient) -> None:
    for i in range(14):
        import_note(client, f"t{i}", f"b{i}")
    use(client, answer(*((f"G{i}", [i + 1]) for i in range(14))))
    assert client.post("/api/notes/categorize").json() == {"grouped": 12, "groups": 12}


def test_only_unsorted_notes_are_sent(client: TestClient) -> None:
    linked = import_note(client, "linked", "x")
    import_note(client, "loose", "y")
    assert client.patch(f"/api/notes/{linked}", json={"node_id": "backend/apis"}).status_code == 200
    model = use(client, answer(("A", [1])))
    client.post("/api/notes/categorize")
    prompt = model.calls[0]["messages"][0].text
    assert "loose" in prompt and "linked" not in prompt
    assert categories(client)["linked"] is None


def test_nothing_to_sort_calls_no_model(client: TestClient) -> None:
    model = use(client, answer(("A", [1])))
    response = client.post("/api/notes/categorize")
    assert response.json() == {"grouped": 0, "groups": 0}
    assert model.calls == []


# Scenario: No provider
def test_no_provider(client: TestClient) -> None:
    import_note(client, "loose", "y")
    response = client.post("/api/notes/categorize")
    assert response.status_code >= 400 and response.json()["detail"]
    assert categories(client) == {"loose": None}


def test_provider_error_is_a_502(client: TestClient) -> None:
    import_note(client, "loose", "y")
    use(client, ProviderError("down", "unavailable"))
    assert client.post("/api/notes/categorize").status_code == 502


# Scenario: Another user's notes
def test_another_users_notes_are_untouched(client: TestClient, second_client: TestClient) -> None:
    import_note(client, "mine", "secret-a")
    import_note(second_client, "theirs", "secret-b")
    model = use(second_client, answer(("B", [1])))
    assert second_client.post("/api/notes/categorize").status_code == 200
    assert "secret-a" not in model.calls[0]["messages"][0].text
    assert categories(client) == {"mine": None}
    assert categories(second_client) == {"theirs": "B"}


# Scenario: Limits
def test_member_counts_one_request_and_admin_none(
    client: TestClient, second_client: TestClient
) -> None:
    add_shared(client)
    client.app.state.llm_factory = FakeFactory(answer(("A", [1])), answer(("A", [1])))  # type: ignore[attr-defined]
    import_note(second_client, "m", "x")
    import_note(client, "a", "x")
    assert second_client.post("/api/notes/categorize").status_code == 200
    assert status(second_client)["used_today"] == 1
    set_usage(client, MEMBER_EMAIL, utc_today(), 10)
    assert second_client.post("/api/notes/categorize").status_code == 429
    assert client.post("/api/notes/categorize").status_code == 200
    assert status(client)["used_today"] == 0


def test_header_is_required(client: TestClient) -> None:
    for path, body in (
        ("/api/notes/categorize", None),
        (RENAME, {"from": "a", "to": "b"}),
    ):
        response = client.post(path, json=body, headers={"X-LearningHub": ""})
        assert response.status_code == 403, path


# Scenario: Rename a group
def test_rename_and_merge(client: TestClient) -> None:
    five(client)
    use(client, answer(("Kubernetes", [1, 2]), ("K8s", [3])))
    client.post("/api/notes/categorize")
    r = client.post(RENAME, json={"from": "Kubernetes", "to": "  Cloud  "})
    assert (r.status_code, r.json()) == (200, {"renamed": 2})
    r = client.post(RENAME, json={"from": "K8s", "to": "Cloud"})
    assert r.json() == {"renamed": 1}
    assert [t for t, c in categories(client).items() if c == "Cloud"] == ["n5", "n4", "n3"]


def test_rename_errors(client: TestClient) -> None:
    five(client)
    use(client, answer(("A", [1])))
    client.post("/api/notes/categorize")
    assert client.post(RENAME, json={"from": "Nope", "to": "B"}).status_code == 404
    assert client.post(RENAME, json={"from": "A", "to": "  "}).status_code == 422
    assert client.post(RENAME, json={"from": "A", "to": "x" * 41}).status_code == 422
    assert client.post(RENAME, json={"from": "A", "to": "x" * 40}).status_code == 200


def test_rename_is_per_user(client: TestClient, second_client: TestClient) -> None:
    import_note(client, "mine", "a")
    use(client, answer(("A", [1])))
    client.post("/api/notes/categorize")
    assert second_client.post(RENAME, json={"from": "A", "to": "B"}).status_code == 404
    assert categories(client) == {"mine": "A"}


# Scenario: Listed in Settings
def test_note_sorter_is_listed_without_tools(client: TestClient) -> None:
    agents = {a["id"]: a for a in client.get("/api/agents").json()}
    assert agents["note-sorter"]["name"] == "Note sorter"
    tools = client.get("/api/agents/tools").json()
    assert all("note-sorter" not in t["agents"] for t in tools)
    assert client.get("/api/agents/areas").status_code == 200


# --- save_learned_note category ------------------------------------------------------------


def save_in_chat(client: TestClient, **args: Any) -> None:
    use(client, save(**args), Turn(text="done"))
    assert chat(client, "explain k8s").status_code == 200


# Scenario: Saved into an existing group
def test_saved_into_an_existing_group_keeps_its_spelling(client: TestClient) -> None:
    import_note(client, "old", "x")
    use(client, answer(("Kubernetes", [1])))
    client.post("/api/notes/categorize")
    client.app.state.llm_factory = FakeFactory(  # type: ignore[attr-defined]
        save(title="Pods", markdown=WRITE_UP, category="  kubernetes "), Turn(text="done")
    )
    assert chat(client, "explain pods").status_code == 200
    assert categories(client)["Pods"] == "Kubernetes"


def test_new_category_and_too_long_category(client: TestClient) -> None:
    save_in_chat(client, title="Pods", markdown=WRITE_UP, category="Cloud Native")
    assert categories(client) == {"Pods": "Cloud Native"}
    client.app.state.llm_factory = FakeFactory(  # type: ignore[attr-defined]
        save(title="Other", markdown=WRITE_UP + "x", category="x" * 41), Turn(text="done")
    )
    assert chat(client, "explain more").status_code == 200
    assert set(categories(client)) == {"Pods"}  # refused, nothing saved


# Scenario: Saved with a node
def test_category_is_ignored_with_a_node(client: TestClient) -> None:
    save_in_chat(client, title="Redis", markdown=WRITE_UP, node_id="backend/redis", category="X")
    [item] = client.get("/api/notes").json()
    assert item["node_id"] == "backend/redis" and item["category"] is None


def test_tool_spec_and_instructions_mention_category() -> None:
    spec = next(s for s in ASSISTANT_SPECS if s.name == "save_learned_note")
    assert "category" in spec.parameters["properties"]
    assert "category" in AGENTS["assistant"].instructions
