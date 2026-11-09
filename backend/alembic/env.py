from logging.config import fileConfig

from alembic import context
from sqlalchemy import Connection, engine_from_config, pool, text

from app.config import get_settings
from app.db import Base

config = context.config
if config.config_file_name is not None:
    # Keep the app's loggers (for example learninghub.llm) working when run in-process.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# An explicit URL (for example from tests) wins over the app settings. The value goes through
# configparser interpolation, so a URL-encoded password's '%' must be doubled.
if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))

# After every upgrade: row-level security on every table of the public schema, and no rights for
# Supabase's API roles (anon, authenticated) where they exist. The app connects as the tables'
# owner, which RLS does not restrict; a hosted database's REST API then reads nothing.
LOCK_DOWN = """
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END $$;
"""


def lock_down(connection: Connection) -> None:
    connection.execute(text(LOCK_DOWN))


target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
            lock_down(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
