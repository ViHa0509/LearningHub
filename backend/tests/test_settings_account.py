"""Spec: settings - Profile details, Preferences, Delete account, Delete all notes (backend)."""

from typing import Any

import pytest

from app.agent.loop import Page, system_prompt
from tests.auth_fakes import EMAIL, AuthKit
from tests.test_admin_users import ANA, admin_kit, import_file, member, scalar, user_id


def lesson(client: Any, body: str) -> None:
    assert client.put("/api/lessons/backend/caching", json={"body": body}).status_code == 200


# --- profile and preferences


def test_profile_is_trimmed_and_limited(kit: AuthKit) -> None:
    admin_kit(kit)
    saved = kit.client.put("/api/auth/profile", json={"display_name": "  Ann  ", "bio": "Hi"})
    assert saved.status_code == 200
    assert (saved.json()["display_name"], saved.json()["bio"]) == ("Ann", "Hi")
    assert kit.client.get("/api/auth/me").json()["display_name"] == "Ann"
    assert kit.client.put("/api/auth/profile", json={"display_name": "x" * 80}).status_code == 200
    for bad in (
        {"display_name": ""},
        {"display_name": "   "},
        {"display_name": "x" * 81},
        {"display_name": "Ann", "bio": "b" * 501},
    ):
        assert kit.client.put("/api/auth/profile", json=bad).status_code == 422
    assert kit.client.get("/api/auth/me").json()["display_name"] == "x" * 80
    ok = kit.client.put("/api/auth/profile", json={"display_name": "A", "bio": "b" * 500})
    assert ok.status_code == 200


def test_preferences_default_then_merge(kit: AuthKit) -> None:
    admin_kit(kit)
    assert kit.client.get("/api/auth/me").json()["preferences"] == {
        "answer_language": "auto",
        "default_effort": "medium",
    }
    body = {"answer_language": "vi", "default_effort": "high"}
    assert kit.client.put("/api/auth/preferences", json=body).json()["preferences"] == body
    assert kit.client.get("/api/auth/me").json()["preferences"] == body
    assert scalar("SELECT preferences->>'answer_language' FROM users") == "vi"
    for bad in ({"answer_language": "fr", "default_effort": "low"}, {"default_effort": "max"}):
        assert kit.client.put("/api/auth/preferences", json=bad).status_code == 422


def test_preferences_need_the_app_header(kit: AuthKit) -> None:
    admin_kit(kit)
    bare = kit.client.put("/api/auth/preferences", json={}, headers={"X-LearningHub": ""})
    assert bare.status_code in (400, 403)


# Scenario: Answer language
def test_system_prompt_line_for_each_language(kit: AuthKit) -> None:
    catalog = kit.app.state.catalog
    assert "Answer in Vietnamese." in system_prompt(Page(), catalog, language="vi")
    assert "Answer in English." in system_prompt(Page(), catalog, language="en")
    auto = system_prompt(Page(), catalog, language="auto")
    assert "Answer in" not in auto
    assert auto == system_prompt(Page(), catalog)


# --- delete account


# Scenario: Member deletes their account
def test_member_deletes_their_account_and_data(kit: AuthKit) -> None:
    admin_kit(kit)
    browser = member(kit)
    import_file(kit.client, "admin-note", "admin text")
    import_file(browser, "member-note", "member text")
    lesson(browser, "Member lesson")
    ana = user_id(ANA)
    key = scalar(f"SELECT storage_key FROM notes WHERE user_id = '{ana}'")

    for wrong in ("", "other@example.test"):
        refused = browser.request("DELETE", "/api/auth/account", json={"confirm_email": wrong})
        assert refused.status_code == 422
    assert browser.get("/api/auth/me").status_code == 200

    done = browser.request(
        "DELETE", "/api/auth/account", json={"confirm_email": " ANA@example.test"}
    )
    assert done.status_code == 204
    assert browser.get("/api/auth/me").status_code == 401
    assert kit.login(browser, ANA, "ana's long password").status_code == 401
    for table in ("notes", "lessons", "sessions"):
        assert scalar(f"SELECT count(*) FROM {table} WHERE user_id = '{ana}'") == 0
    with pytest.raises(FileNotFoundError):
        kit.app.state.store.get(key)
    assert [n["title"] for n in kit.client.get("/api/notes").json()] == ["admin-note"]


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40


def avatar_of(email: str) -> str:
    return scalar(f"SELECT avatar_key FROM users WHERE email = '{email}'")


def delete_account(browser: Any, email: str) -> None:
    done = browser.request("DELETE", "/api/auth/account", json={"confirm_email": email})
    assert done.status_code == 204


def test_deleting_an_account_removes_its_avatar_file(kit: AuthKit) -> None:
    admin_kit(kit)
    browser = member(kit)
    files = {"file": ("a.png", PNG, "image/png")}
    assert browser.post("/api/auth/avatar", files=files).status_code == 200
    key = avatar_of(ANA)
    assert kit.app.state.store.get(key) == PNG
    delete_account(browser, ANA)
    with pytest.raises(FileNotFoundError):
        kit.app.state.store.get(key)


def test_deleting_an_account_keeps_an_avatar_another_user_shares(kit: AuthKit) -> None:
    admin_kit(kit)
    browser = member(kit)
    files = {"file": ("a.png", PNG, "image/png")}
    assert kit.client.post("/api/auth/avatar", files=files).status_code == 200
    assert browser.post("/api/auth/avatar", files=files).status_code == 200
    key = avatar_of(ANA)
    assert key == avatar_of(EMAIL)
    delete_account(browser, ANA)
    assert kit.app.state.store.get(key) == PNG


# Scenario: Admin cannot
def test_admin_cannot_delete_their_account(kit: AuthKit) -> None:
    admin_kit(kit)
    refused = kit.client.request("DELETE", "/api/auth/account", json={"confirm_email": EMAIL})
    assert refused.status_code == 422
    assert refused.json()["detail"] == "You cannot delete your own account"
    assert kit.client.get("/api/auth/me").status_code == 200


# --- delete all notes


# Scenario: Delete all notes
def test_delete_all_notes_keeps_lessons_and_a_shared_file(kit: AuthKit) -> None:
    admin_kit(kit)
    browser = member(kit)
    mine = import_file(kit.client, "shared", "same bytes")
    theirs = import_file(browser, "shared", "same bytes")
    import_file(kit.client, "only-mine", "just mine")
    lesson(kit.client, "Admin lesson")
    shared_key = scalar(f"SELECT storage_key FROM notes WHERE id = '{mine['note']['id']}'")
    own_key = scalar("SELECT storage_key FROM notes WHERE title = 'only-mine'")

    wrong = kit.client.request("DELETE", "/api/notes", json={"confirm": "delete"})
    assert wrong.status_code == 422
    assert len(kit.client.get("/api/notes").json()) == 2

    done = kit.client.request("DELETE", "/api/notes", json={"confirm": "DELETE"})
    assert done.status_code == 204
    assert kit.client.get("/api/notes").json() == []
    assert kit.client.get("/api/lessons/backend/caching").json()["body"] == "Admin lesson"
    store = kit.app.state.store
    assert store.get(shared_key)
    with pytest.raises(FileNotFoundError):
        store.get(own_key)
    assert browser.get(f"/api/notes/{theirs['note']['id']}").status_code == 200
