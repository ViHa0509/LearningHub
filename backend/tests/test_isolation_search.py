"""Spec: app-search - search is scoped to the user (follows test_isolation_notes)."""

from fastapi.testclient import TestClient

from tests.test_search import add_note, put_lesson, search


# Scenario: Member cannot find the admin's data
def test_member_cannot_find_the_admins_lesson_or_note(
    client: TestClient, second_client: TestClient
) -> None:
    put_lesson(client, "backend/caching", "the zebra-protocol lesson")
    add_note(client, "Admin note", "the zebra-protocol note")
    mine = search(client, "zebra-protocol")
    assert len(mine["lessons"]) == 1 and len(mine["notes"]) == 1

    theirs = search(second_client, "zebra-protocol")
    assert theirs == {"query": "zebra-protocol", "topics": [], "lessons": [], "notes": []}
    # Same answer as for text nobody has: nothing reveals that the data exists.
    assert search(second_client, "no-such-text")["lessons"] == theirs["lessons"]


# Scenario: Each user finds their own
def test_each_user_finds_only_their_own_zebra_notes(
    client: TestClient, second_client: TestClient
) -> None:
    admin_note = add_note(client, "Zebra notes", "admin text")
    member_note = add_note(second_client, "Zebra notes", "member text")
    assert admin_note != member_note
    assert [n["id"] for n in search(client, "zebra")["notes"]] == [admin_note]
    assert [n["id"] for n in search(second_client, "zebra")["notes"]] == [member_note]


def test_each_user_finds_only_their_own_lesson(
    client: TestClient, second_client: TestClient
) -> None:
    put_lesson(client, "backend/caching", "zebra admin lesson")
    put_lesson(second_client, "backend/caching", "zebra member lesson")
    (mine,) = search(client, "zebra")["lessons"]
    (theirs,) = search(second_client, "zebra")["lessons"]
    assert "admin" in mine["snippet"] and "member" not in mine["snippet"]
    assert "member" in theirs["snippet"] and "admin" not in theirs["snippet"]
