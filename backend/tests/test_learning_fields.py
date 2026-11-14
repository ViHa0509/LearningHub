"""Spec: learning-fields (fields, areas, topics, publishing, the outline agent) and
roadmap-catalog (the catalog a user sees)."""

from typing import Any

from fastapi.testclient import TestClient

from app.agent.messages import ToolCall, Turn
from tests.test_agent_chat import use
from tests.test_linking import HTML

MISSING = "00000000-0000-0000-0000-000000000000"
NOTE_FILE = ("files", ("n.html", b"<html><title>N</title>x</html>", HTML))


def make_field(client: TestClient, title: str = "Cloud") -> dict[str, Any]:
    response = client.post("/api/fields", json={"title": title})
    assert response.status_code == 201, response.text
    return dict(response.json())


def make_area(client: TestClient, field_id: str, slug: str = "aws", **extra: Any) -> dict[str, Any]:
    body = {"slug": slug, "title": slug.upper(), **extra}
    response = client.post(f"/api/fields/{field_id}/areas", json=body)
    assert response.status_code == 201, response.text
    return dict(response.json())


def put_topics(client: TestClient, slug: str, topics: list[dict[str, Any]]) -> Any:
    return client.put(f"/api/areas/{slug}/topics", json={"topics": topics})


def fields(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/fields")
    assert response.status_code == 200, response.text
    return list(response.json())


def import_note(client: TestClient) -> str:
    response = client.post("/api/notes/import", files=[NOTE_FILE])
    return str(response.json()["results"][0]["note"]["id"])


def aws(client: TestClient) -> str:
    """A field "Cloud" with the area `aws` and topics iam, compute, ec2 (child of compute)."""
    field = make_field(client)
    make_area(client, field["id"])
    response = put_topics(
        client,
        "aws",
        [
            {"slug": "iam", "title": "IAM", "description": "Identity"},
            {"slug": "compute", "title": "Compute"},
            {"slug": "ec2", "title": "EC2", "parent": "compute"},
        ],
    )
    assert response.status_code == 200, response.text
    return str(field["id"])


# --- Fields and areas ----------------------------------------------------------------


# Scenario: IT tab
def test_a_user_without_fields_sees_only_the_it_field(client: TestClient) -> None:
    listed = fields(client)
    assert [f["id"] for f in listed] == ["it"]
    assert listed[0]["title"] == "IT" and listed[0]["editable"] is False
    assert len(listed[0]["areas"]) == 6
    assert all(a["field_id"] is None and a["field_title"] == "IT" for a in listed[0]["areas"])


# Scenario: New field and area
def test_new_field_and_area_are_a_domain_with_a_map(client: TestClient) -> None:
    field = make_field(client)
    assert field["title"] == "Cloud" and field["published"] is False and field["areas"] == []
    area = make_area(client, field["id"], description="Amazon")
    assert area["id"] == "aws" and area["field_id"] == field["id"]
    assert area["field_title"] == "Cloud" and area["editable"] is True
    assert area["node_count"] == 0 and area["description"] == "Amazon"
    listed = fields(client)
    assert [f["title"] for f in listed] == ["IT", "Cloud"]
    assert [a["id"] for a in listed[1]["areas"]] == ["aws"]
    domains = {d["id"]: d for d in client.get("/api/domains").json()}
    assert domains["aws"]["field_title"] == "Cloud" and domains["aws"]["editable"] is True
    assert domains["backend"]["field_title"] == "IT" and domains["backend"]["editable"] is False
    roadmap = client.get("/api/domains/aws/roadmap")
    assert roadmap.status_code == 200 and roadmap.json()["nodes"] == []


# Scenario: Slug taken
def test_slug_of_a_roadmap_or_another_area_is_taken(client: TestClient) -> None:
    field = make_field(client)
    make_area(client, field["id"], "aws")
    for slug in ("backend", "aws"):
        response = client.post(
            f"/api/fields/{field['id']}/areas", json={"slug": slug, "title": "X"}
        )
        assert response.status_code == 409, slug
        assert "taken" in response.json()["detail"]


def test_invalid_field_and_area_input_is_422_with_field_names(client: TestClient) -> None:
    assert client.post("/api/fields", json={"title": "  "}).status_code == 422
    assert client.post("/api/fields", json={"title": "x" * 61}).status_code == 422
    field = make_field(client)
    for body in (
        {"slug": "AWS", "title": "A"},
        {"slug": "a", "title": "A"},
        {"slug": "aws", "title": ""},
        {"slug": "aws", "title": "A", "description": "x" * 201},
    ):
        response = client.post(f"/api/fields/{field['id']}/areas", json=body)
        assert response.status_code == 422
        assert {"field", "msg"} <= set(response.json()["detail"][0])


def test_rename_reorder_and_delete(client: TestClient) -> None:
    first = make_field(client, "Cloud")
    second = make_field(client, "Driving")
    make_area(client, first["id"], "aws")
    renamed = client.patch(f"/api/fields/{first['id']}", json={"title": "Cloud 2", "order": 5})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Cloud 2" and renamed.json()["order"] == 5
    assert renamed.json()["areas"][0]["field_title"] == "Cloud 2"
    assert [f["title"] for f in fields(client)] == ["IT", "Driving", "Cloud 2"]
    area = client.patch("/api/areas/aws", json={"title": "Amazon", "description": "d", "order": 3})
    assert area.status_code == 200
    assert area.json()["title"] == "Amazon" and area.json()["id"] == "aws"
    assert client.delete("/api/areas/aws").status_code == 204
    assert client.get("/api/domains/aws/roadmap").status_code == 404
    assert client.delete(f"/api/fields/{second['id']}").status_code == 204
    assert [f["title"] for f in fields(client)] == ["IT", "Cloud 2"]


def test_the_it_field_cannot_be_changed(client: TestClient) -> None:
    assert client.patch("/api/fields/it", json={"title": "X"}).status_code == 403
    assert client.delete("/api/fields/it").status_code == 403
    assert client.post("/api/fields/it/areas", json={"slug": "xx", "title": "X"}).status_code == 403
    assert client.patch(f"/api/fields/{MISSING}", json={"title": "X"}).status_code == 404
    assert client.patch("/api/fields/not-an-id", json={"title": "X"}).status_code == 404


# Scenario: Another user's field
def test_another_users_private_field_is_not_found(
    client: TestClient, second_client: TestClient
) -> None:
    field = make_field(client)
    make_area(client, field["id"])
    put_topics(client, "aws", [{"slug": "iam", "title": "IAM"}])
    assert [f["id"] for f in fields(second_client)] == ["it"]
    assert "aws" not in {d["id"] for d in second_client.get("/api/domains").json()}
    assert second_client.get("/api/domains/aws/roadmap").status_code == 404
    assert second_client.patch(f"/api/fields/{field['id']}", json={"title": "X"}).status_code == 404
    assert second_client.delete(f"/api/fields/{field['id']}").status_code == 404
    assert second_client.patch("/api/areas/aws", json={"title": "X"}).status_code == 404
    assert second_client.delete("/api/areas/aws").status_code == 404
    assert put_topics(second_client, "aws", []).status_code == 404
    new_area = {"slug": "azure", "title": "Azure"}
    assert second_client.post(f"/api/fields/{field['id']}/areas", json=new_area).status_code == 404
    # The slug is global: B cannot take it either.
    own = make_field(second_client, "Mine")
    taken = second_client.post(f"/api/fields/{own['id']}/areas", json={"slug": "aws", "title": "A"})
    assert taken.status_code == 409


def test_changes_need_the_app_header(client: TestClient) -> None:
    field = make_field(client)
    bare = TestClient(client.app, cookies=dict(client.cookies))
    assert bare.post("/api/fields", json={"title": "X"}).status_code == 403
    assert bare.patch(f"/api/fields/{field['id']}", json={"title": "X"}).status_code == 403
    assert bare.delete(f"/api/fields/{field['id']}").status_code == 403
    assert bare.get("/api/fields").status_code == 200


# --- Topics of an area ----------------------------------------------------------------


# Scenario: Save topics
def test_save_topics_gives_the_map_and_lesson_pages(client: TestClient) -> None:
    aws(client)
    nodes = client.get("/api/domains/aws/roadmap").json()["nodes"]
    assert [(n["id"], n["full_id"], n["parent"]) for n in nodes] == [
        ("iam", "aws/iam", None),
        ("compute", "aws/compute", None),
        ("ec2", "aws/ec2", "compute"),
    ]
    assert nodes[0]["description"] == "Identity" and nodes[1]["description"] is None
    assert client.get("/api/lessons/aws/iam").status_code == 200
    saved = client.put("/api/lessons/aws/iam", json={"body": "# IAM", "source": "user"})
    assert saved.status_code == 200
    assert client.get("/api/lessons/aws/nothing").status_code == 404
    summary = {d["id"]: d for d in client.get("/api/domains").json()}["aws"]
    assert summary["node_count"] == 3


def test_put_topics_returns_the_roadmap_and_replaces_the_list(client: TestClient) -> None:
    aws(client)
    response = put_topics(client, "aws", [{"slug": "s3", "title": "S3"}])
    assert response.status_code == 200
    assert [n["full_id"] for n in response.json()["nodes"]] == ["aws/s3"]
    assert put_topics(client, "aws", []).json()["nodes"] == []


# Scenario: Invalid topics
def test_invalid_topics_save_nothing_and_say_what_is_wrong(client: TestClient) -> None:
    aws(client)

    def refused(topics: list[dict[str, Any]]) -> list[dict[str, Any]]:
        response = put_topics(client, "aws", topics)
        assert response.status_code == 422, topics
        nodes = client.get("/api/domains/aws/roadmap").json()["nodes"]
        assert [n["id"] for n in nodes] == ["iam", "compute", "ec2"]
        return list(response.json()["detail"])

    detail = refused([{"slug": "a", "title": "A"}, {"slug": "a", "title": "B"}])
    assert detail[0]["index"] == 1 and detail[0]["field"] == "slug"
    detail = refused([{"slug": "a", "title": "A", "parent": "missing"}])
    assert detail[0]["index"] == 0 and detail[0]["field"] == "parent"
    assert refused([{"slug": "a", "title": "A", "parent": "a"}])[0]["field"] == "parent"
    cycle = refused(
        [{"slug": "a", "title": "A", "parent": "b"}, {"slug": "b", "title": "B", "parent": "a"}]
    )
    assert "cycle" in cycle[0]["msg"]
    assert refused([{"slug": "Bad Slug", "title": "A"}])[0]["field"] == "slug"
    assert refused([{"slug": "a", "title": " "}])[0]["field"] == "title"
    too_long = refused([{"slug": "a", "title": "A", "description": "x" * 301}])
    assert too_long[0]["field"] == "description"
    too_many = [{"slug": f"t{i}", "title": "T"} for i in range(301)]
    assert refused(too_many)[0]["index"] is None
    assert put_topics(client, "aws", too_many[:300]).status_code == 200


# Scenario: Removed topic keeps notes
def test_removing_a_topic_keeps_its_notes_and_lessons(client: TestClient) -> None:
    aws(client)
    note_id = import_note(client)
    linked = client.patch(f"/api/notes/{note_id}", json={"node_id": "aws/iam"})
    assert linked.status_code == 200 and linked.json()["node_missing"] is False
    client.put("/api/lessons/aws/iam", json={"body": "keep", "source": "user"})
    put_topics(client, "aws", [{"slug": "ec2", "title": "EC2"}])
    note = client.get(f"/api/notes/{note_id}").json()
    assert note["node_id"] == "aws/iam" and note["node_missing"] is True
    # Deleting the whole field leaves them too.
    client.delete(f"/api/fields/{fields(client)[1]['id']}")
    assert client.get(f"/api/notes/{note_id}").json()["node_missing"] is True


# --- The catalog a user sees ----------------------------------------------------------


# Scenario: Own area is a domain
def test_own_area_takes_notes_counts_and_resources(client: TestClient) -> None:
    aws(client)
    note_id = import_note(client)
    assert client.patch(f"/api/notes/{note_id}", json={"node_id": "aws/iam"}).status_code == 200
    assert client.get("/api/domains/aws/counts").json() == {"domain": "aws", "counts": {"iam": 1}}
    summary = {d["id"]: d for d in client.get("/api/domains").json()}["aws"]
    assert summary["learned_nodes"] == 1
    assert client.get("/api/resources/aws/iam").json()["items"] == []
    assert client.get("/api/resources/sync/aws").json()["state"] == "unavailable"


# Scenario: Another user's area is unknown
def test_another_users_area_is_an_unknown_node(
    client: TestClient, second_client: TestClient
) -> None:
    aws(client)
    note_id = import_note(second_client)
    refused = second_client.patch(f"/api/notes/{note_id}", json={"node_id": "aws/iam"})
    assert refused.status_code == 422 and "unknown node" in refused.json()["detail"]
    assert second_client.get("/api/lessons/aws/iam").status_code == 404
    assert second_client.get("/api/resources/aws/iam").status_code == 404
    assert second_client.get("/api/resources/sync/aws").status_code == 404
    assert second_client.get("/api/domains/aws/counts").status_code == 404


def test_catalog_order_is_built_in_then_fields_then_areas(client: TestClient) -> None:
    first = make_field(client, "One")
    second = make_field(client, "Two")
    make_area(client, second["id"], "zz-area")
    make_area(client, first["id"], "bb-area")
    make_area(client, first["id"], "aa-area")
    ids = [d["id"] for d in client.get("/api/domains").json()]
    assert ids[-3:] == ["bb-area", "aa-area", "zz-area"]
    assert "backend" in ids[:-3]


# --- Published fields -----------------------------------------------------------------


# Scenario: Publish
def test_published_field_is_read_only_for_members(
    client: TestClient, second_client: TestClient
) -> None:
    field_id = aws(client)
    published = client.patch(f"/api/fields/{field_id}", json={"published": True})
    assert published.status_code == 200 and published.json()["published"] is True
    listed = fields(second_client)
    assert [f["title"] for f in listed] == ["IT", "Cloud"]
    assert listed[1]["editable"] is False and listed[1]["published"] is True
    assert [a["id"] for a in listed[1]["areas"]] == ["aws"]
    assert listed[1]["areas"][0]["editable"] is False
    roadmap = second_client.get("/api/domains/aws/roadmap")
    assert [n["id"] for n in roadmap.json()["nodes"]] == ["iam", "compute", "ec2"]
    # Read only: 403 on every change.
    assert second_client.patch(f"/api/fields/{field_id}", json={"title": "X"}).status_code == 403
    assert second_client.delete(f"/api/fields/{field_id}").status_code == 403
    assert second_client.patch("/api/areas/aws", json={"title": "X"}).status_code == 403
    assert second_client.delete("/api/areas/aws").status_code == 403
    assert put_topics(second_client, "aws", []).status_code == 403
    new_area = {"slug": "azure", "title": "A"}
    assert second_client.post(f"/api/fields/{field_id}/areas", json=new_area).status_code == 403
    # Notes and lessons stay the member's own.
    note_id = import_note(second_client)
    linked = second_client.patch(f"/api/notes/{note_id}", json={"node_id": "aws/iam"})
    assert linked.status_code == 200
    saved = second_client.put("/api/lessons/aws/iam", json={"body": "mine", "source": "user"})
    assert saved.status_code == 200
    assert client.get("/api/lessons/aws/iam").json()["body"] == ""
    assert client.get("/api/domains/aws/counts").json()["counts"] == {}
    assert second_client.get("/api/domains/aws/counts").json()["counts"] == {"iam": 1}
    # Unpublishing hides it again.
    client.patch(f"/api/fields/{field_id}", json={"published": False})
    assert [f["id"] for f in fields(second_client)] == ["it"]
    assert second_client.get("/api/domains/aws/roadmap").status_code == 404


# Scenario: Members cannot publish
def test_a_member_cannot_publish(second_client: TestClient) -> None:
    field = make_field(second_client, "Mine")
    response = second_client.patch(f"/api/fields/{field['id']}", json={"published": True})
    assert response.status_code == 403
    assert fields(second_client)[1]["published"] is False
    assert (
        second_client.patch(f"/api/fields/{field['id']}", json={"title": "Ok"}).status_code == 200
    )


# --- Outline agent --------------------------------------------------------------------

PROPOSAL = {
    "area": "aws",
    "topics": [
        {"slug": "iam", "title": "IAM", "description": "Identity", "parent": None},
        {"slug": "roles", "title": "Roles", "description": "", "parent": "iam"},
    ],
}


def propose(topics: list[dict[str, Any]], area: str = "aws") -> Turn:
    call = ToolCall(id="p1", name="propose_topics", input={"area": area, "topics": topics})
    return Turn("", (call,))


def outline_chat(client: TestClient) -> Any:
    return client.post(
        "/api/agent/chat",
        json={
            "agent_id": "outline",
            "messages": [{"role": "user", "content": "Draft topics"}],
            "page": {"kind": "roadmap", "domain": "aws"},
        },
    )


# Scenario: Draft and review
def test_outline_agent_proposes_topics_without_saving(client: TestClient) -> None:
    field = make_field(client)
    make_area(client, field["id"])
    topics = [
        {"slug": "iam", "title": "IAM", "description": "Identity"},
        {"slug": "roles", "title": "Roles", "parent": "iam"},
    ]
    fake = use(client, propose(topics), Turn("I proposed two topics."))
    response = outline_chat(client)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["proposed_topics"] == PROPOSAL
    assert body["reply"] == "I proposed two topics."
    assert body["steps"][0]["tool"] == "propose_topics"
    assert "not saved" in body["steps"][0]["summary"]
    assert client.get("/api/domains/aws/roadmap").json()["nodes"] == []
    assert "propose_topics" in {t.name for t in fake.calls[0]["tools"]}
    assert "aws" in fake.calls[0]["system"]


def test_propose_topics_is_only_offered_to_the_outline_agent(client: TestClient) -> None:
    field = make_field(client)
    make_area(client, field["id"])
    fake = use(client, Turn("done"), Turn("done"))
    for agent in ("assistant", "lesson-writer"):
        response = client.post(
            "/api/agent/chat",
            json={"agent_id": agent, "messages": [{"role": "user", "content": "hi"}]},
        )
        assert response.status_code == 200
        assert response.json()["proposed_topics"] is None
    assert len(fake.calls) == 2
    assert all("propose_topics" not in {t.name for t in c["tools"]} for c in fake.calls)


def test_invalid_proposal_goes_back_to_the_model(client: TestClient) -> None:
    field = make_field(client)
    make_area(client, field["id"])
    use(
        client,
        propose([{"slug": "a", "title": "A", "parent": "nope"}]),
        propose([{"slug": "a", "title": "A"}]),
        Turn("fixed"),
    )
    body = outline_chat(client).json()
    errors = [s["summary"].startswith("Error: invalid topics") for s in body["steps"]]
    assert errors == [True, False]
    assert body["proposed_topics"]["topics"][0]["slug"] == "a"


def test_proposal_for_an_area_the_user_cannot_edit_is_refused(client: TestClient) -> None:
    use(client, propose([{"slug": "a", "title": "A"}], area="backend"), Turn("ok"))
    body = outline_chat(client).json()
    assert body["proposed_topics"] is None
    assert body["steps"][0]["summary"].startswith("Error:")
