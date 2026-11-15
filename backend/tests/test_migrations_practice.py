"""Migration 0017: the practice tables."""

from alembic import command
from sqlalchemy import create_engine, inspect, text

from tests.conftest import TEST_DATABASE_URL, alembic_config

USER = "00000000-0000-0000-0000-000000000001"
FIELD = "00000000-0000-0000-0000-0000000000f1"
AREA = "00000000-0000-0000-0000-0000000000a1"
BANK = "00000000-0000-0000-0000-0000000000b1"
QUESTION = "00000000-0000-0000-0000-0000000000c1"
EXAM = "00000000-0000-0000-0000-0000000000e1"
TABLES = {"question_banks", "questions", "question_answers", "exam_attempts"}


def test_0017_creates_the_practice_tables_and_its_downgrade_removes_them() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        assert set(inspect(engine).get_table_names()) >= TABLES
        with engine.connect() as connection:
            locked = connection.scalars(
                text(
                    "SELECT relname FROM pg_class WHERE relname IN "
                    "('question_banks', 'questions', 'question_answers', 'exam_attempts') "
                    "AND relrowsecurity"
                )
            ).all()
        assert set(locked) == TABLES
        uniques = inspect(engine).get_unique_constraints("questions")
        assert ["bank_id", "number"] in [u["column_names"] for u in uniques]
        for table, referred in (
            ("question_banks", "learning_areas"),
            ("questions", "question_banks"),
            ("exam_attempts", "question_banks"),
        ):
            keys = inspect(engine).get_foreign_keys(table)
            assert referred in {k["referred_table"] for k in keys}
            assert all(k["options"].get("ondelete") == "CASCADE" for k in keys)
        answers = inspect(engine).get_pk_constraint("question_answers")
        assert set(answers["constrained_columns"]) == {"user_id", "question_id"}
        # Deleting an area removes its bank, questions, answers and tests; defaults apply.
        with engine.begin() as connection:
            for sql in (
                f"INSERT INTO users (id, email, role) VALUES ('{USER}', 'p@x.test', 'admin')",
                "INSERT INTO learning_fields (id, user_id, title) "
                f"VALUES ('{FIELD}', '{USER}', 'F')",
                "INSERT INTO learning_areas (id, field_id, slug, title) "
                f"VALUES ('{AREA}', '{FIELD}', 'lic', 'L')",
                "INSERT INTO question_banks (id, area_id, title, rules, question_count) "
                f"VALUES ('{BANK}', '{AREA}', 'B', '{{}}', 1)",
                "INSERT INTO questions (id, bank_id, number, topic_slug, text, options, answer) "
                f"VALUES ('{QUESTION}', '{BANK}', 1, 't', 'Q', '[\"a\", \"b\"]', 1)",
                "INSERT INTO question_answers (user_id, question_id, last_correct, answered_at) "
                f"VALUES ('{USER}', '{QUESTION}', true, now())",
                "INSERT INTO exam_attempts "
                "(id, user_id, bank_id, question_ids, started_at, deadline) "
                f"VALUES ('{EXAM}', '{USER}', '{BANK}', '[]', now(), now())",
            ):
                connection.execute(text(sql))
            row = connection.execute(text("SELECT critical, image_key FROM questions")).one()
            assert row.critical is False and row.image_key is None
            exam = connection.execute(
                text("SELECT answers, failed_on_critical, submitted_at FROM exam_attempts")
            ).one()
            assert (
                exam.answers == {} and exam.failed_on_critical == [] and exam.submitted_at is None
            )
            connection.execute(text("DELETE FROM learning_areas"))
            left = [
                connection.execute(text(f"SELECT count(*) FROM {t}")).scalar()
                for t in sorted(TABLES)
            ]
            assert left == [0, 0, 0, 0]
            connection.execute(text("DELETE FROM users"))
        command.downgrade(config, "0016")
        assert not TABLES & set(inspect(engine).get_table_names())
    finally:
        command.upgrade(config, "head")
        engine.dispose()


def test_0018_adds_the_chosen_option_and_bookmarks_and_its_downgrade_removes_them() -> None:
    config = alembic_config()
    engine = create_engine(TEST_DATABASE_URL)
    try:
        command.upgrade(config, "head")
        inspector = inspect(engine)
        assert "question_bookmarks" in inspector.get_table_names()
        with engine.connect() as connection:
            locked = connection.scalars(
                text(
                    "SELECT relname FROM pg_class "
                    "WHERE relname = 'question_bookmarks' AND relrowsecurity"
                )
            ).all()
        assert locked == ["question_bookmarks"]
        pk = inspector.get_pk_constraint("question_bookmarks")
        assert set(pk["constrained_columns"]) == {"user_id", "question_id"}
        keys = inspector.get_foreign_keys("question_bookmarks")
        assert {k["referred_table"] for k in keys} == {"users", "questions"}
        assert all(k["options"].get("ondelete") == "CASCADE" for k in keys)
        choice = next(
            c for c in inspector.get_columns("question_answers") if c["name"] == "last_choice"
        )
        assert choice["nullable"] is True
        # Deleting the area removes the bookmark; an answer without a choice keeps a null one.
        with engine.begin() as connection:
            for sql in (
                f"INSERT INTO users (id, email, role) VALUES ('{USER}', 'p@x.test', 'admin')",
                "INSERT INTO learning_fields (id, user_id, title) "
                f"VALUES ('{FIELD}', '{USER}', 'F')",
                "INSERT INTO learning_areas (id, field_id, slug, title) "
                f"VALUES ('{AREA}', '{FIELD}', 'lic', 'L')",
                "INSERT INTO question_banks (id, area_id, title, rules, question_count) "
                f"VALUES ('{BANK}', '{AREA}', 'B', '{{}}', 1)",
                "INSERT INTO questions (id, bank_id, number, topic_slug, text, options, answer) "
                f"VALUES ('{QUESTION}', '{BANK}', 1, 't', 'Q', '[\"a\", \"b\"]', 1)",
                "INSERT INTO question_answers (user_id, question_id, last_correct, answered_at) "
                f"VALUES ('{USER}', '{QUESTION}', true, now())",
                "INSERT INTO question_bookmarks (user_id, question_id) "
                f"VALUES ('{USER}', '{QUESTION}')",
            ):
                connection.execute(text(sql))
            kept = connection.execute(text("SELECT last_choice FROM question_answers")).scalar()
            assert kept is None
            connection.execute(text("DELETE FROM learning_areas"))
            left = connection.execute(text("SELECT count(*) FROM question_bookmarks")).scalar()
            assert left == 0
            connection.execute(text("DELETE FROM users"))
        command.downgrade(config, "0017")
        inspector = inspect(engine)
        assert "question_bookmarks" not in inspector.get_table_names()
        assert "last_choice" not in {c["name"] for c in inspector.get_columns("question_answers")}
    finally:
        command.upgrade(config, "head")
        engine.dispose()
