"""Validate a backup archive, then replace the data with it.

Everything is checked before anything is written. The database part is one transaction;
blobs are content-addressed, so a blob left behind by a failed restore is harmless.
Nothing here logs file contents or keys.
"""

import hashlib
import json
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ValidationError
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.agent.llm.params import PROVIDER_TYPES
from app.data_sync.backup import (
    BLOB_KEY,
    DATA_FILES,
    FORMAT,
    MAX_ENTRIES,
    MAX_TOTAL_BYTES,
    AgentProviderRow,
    AgentSettingRow,
    LessonRow,
    Manifest,
    NoteRow,
    ProviderRow,
    build_backup,
    known_migrations,
)
from app.db import AgentProvider, AgentSetting, AIProvider, Lesson, Note
from app.storage import FileStore, release_blob

KEEP_AUTO_BACKUPS = 3
CHUNK = 1024 * 1024
MAX_JSON_BYTES = 200 * 1024 * 1024


class RestoreRefused(Exception):
    """The archive is invalid or unsafe; ``detail`` says why. Nothing was changed."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


@dataclass
class Parsed:
    manifest: Manifest
    notes: list[NoteRow]
    lessons: list[LessonRow]
    providers: list[ProviderRow]
    assignments: list[AgentProviderRow]
    switches: list[AgentSettingRow]
    blob_names: list[str]  # archive member names of the files


def _check_name(name: str) -> None:
    if (
        name.startswith(("/", "\\"))
        or "\\" in name
        or ".." in name.split("/")
        or (len(name) > 1 and name[1] == ":")
    ):
        raise RestoreRefused(f"unsafe entry name in the archive: {name[:80]!r}")
    if name == "manifest.json" or name in DATA_FILES.values():
        return
    if name.startswith("files/") and BLOB_KEY.match(name.removeprefix("files/")):
        return
    raise RestoreRefused(f"unexpected entry in the archive: {name[:80]!r}")


class _Budget:
    """Running count of expanded bytes, so a lying header cannot exceed the limit."""

    def __init__(self) -> None:
        self.left = MAX_TOTAL_BYTES

    def take(self, n: int) -> None:
        self.left -= n
        if self.left < 0:
            raise RestoreRefused("the archive expands beyond the 2 GB limit")


def _read_limited(archive: zipfile.ZipFile, name: str, budget: _Budget, cap: int) -> bytes:
    out = bytearray()
    with archive.open(name) as member:
        while chunk := member.read(CHUNK):
            budget.take(len(chunk))
            out += chunk
            if len(out) > cap:
                raise RestoreRefused(f"{name} is too large")
    return bytes(out)


def _rows[T: BaseModel](archive: zipfile.ZipFile, name: str, model: type[T], b: _Budget) -> list[T]:
    try:
        raw = json.loads(_read_limited(archive, name, b, MAX_JSON_BYTES))
        if not isinstance(raw, list):
            raise ValueError("not a list")
        return [model.model_validate(item) for item in raw]
    except (ValueError, ValidationError):
        raise RestoreRefused(f"{name} is not valid backup data") from None


def validate(path: Path) -> Parsed:
    """Check the whole archive; raise RestoreRefused before anything is written."""
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError):
        raise RestoreRefused("the file is not a zip archive") from None
    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_ENTRIES:
            raise RestoreRefused("the archive has too many entries")
        names = [i.filename for i in infos]
        if len(set(names)) != len(names):
            raise RestoreRefused("the archive has duplicate entries")
        total = 0
        for info in infos:
            _check_name(info.filename)
            total += info.file_size
        if total > MAX_TOTAL_BYTES:
            raise RestoreRefused("the archive expands beyond the 2 GB limit")
        if "manifest.json" not in names or any(n not in names for n in DATA_FILES.values()):
            raise RestoreRefused("the archive is not a Learning Hub backup")
        budget = _Budget()
        try:
            manifest = Manifest.model_validate(
                json.loads(_read_limited(archive, "manifest.json", budget, MAX_JSON_BYTES))
            )
        except (ValueError, ValidationError):
            raise RestoreRefused("manifest.json is not valid") from None
        if manifest.format != FORMAT:
            raise RestoreRefused(f"unsupported backup format {manifest.format}")
        if manifest.migration not in known_migrations():
            raise RestoreRefused(
                "the backup comes from a newer or unknown database migration "
                f"({manifest.migration[:40]}); update this server first"
            )
        notes = _rows(archive, DATA_FILES["notes"], NoteRow, budget)
        lessons = _rows(archive, DATA_FILES["lessons"], LessonRow, budget)
        providers = _rows(archive, DATA_FILES["ai_providers"], ProviderRow, budget)
        assignments = _rows(archive, DATA_FILES["agent_providers"], AgentProviderRow, budget)
        switches = _rows(archive, DATA_FILES["agent_settings"], AgentSettingRow, budget)
        blobs = [n for n in names if n.startswith("files/")]
        for name in blobs:
            match = BLOB_KEY.match(name.removeprefix("files/"))
            assert match is not None
            digest = hashlib.sha256()
            with archive.open(name) as member:
                while chunk := member.read(CHUNK):
                    budget.take(len(chunk))
                    digest.update(chunk)
            if digest.hexdigest() != match.group(2):
                raise RestoreRefused(f"a file does not match its checksum: {name[-80:]}")
    present = {n.removeprefix("files/") for n in blobs}
    if any(n.storage_key not in present for n in notes):
        raise RestoreRefused("a note's file is missing from the archive")
    provider_ids = {p.id for p in providers}
    if any(a.provider_id not in provider_ids for a in assignments):
        raise RestoreRefused("an agent uses a provider that is not in the archive")
    if any(p.provider_type not in PROVIDER_TYPES for p in providers):
        raise RestoreRefused("the archive has an unknown provider type")
    return Parsed(manifest, notes, lessons, providers, assignments, switches, blobs)


def write_auto_backup(
    session: Session,
    user_id: UUID,
    store: FileStore,
    storage_dir: Path,
    version: str,
    now: datetime,
) -> Path:
    folder = storage_dir / "backups"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"auto-{now:%Y%m%d-%H%M%S-%f}.zip"
    with target.open("wb") as handle:
        build_backup(session, user_id, store, version, now, handle)
    for old in sorted(folder.glob("auto-*.zip"))[:-KEEP_AUTO_BACKUPS]:
        old.unlink(missing_ok=True)
    return target


def restore_archive(
    path: Path,
    factory: sessionmaker[Session],
    store: FileStore,
    storage_dir: Path,
    version: str,
    now: Callable[[], datetime],
    user_id: UUID,
) -> dict[str, Any]:
    """Validate, back up the user's data, write the files, replace the user's rows.

    Notes and providers get new ids (the archive may come from another user or server);
    only ``user_id``'s rows are deleted. Blobs no note refers to any more are released.
    """
    parsed = validate(path)
    with factory() as session:
        write_auto_backup(session, user_id, store, storage_dir, version, now())
    with zipfile.ZipFile(path) as archive:
        for name in parsed.blob_names:
            key = name.removeprefix("files/")
            try:
                store.get(key)
                continue  # content-addressed: already there
            except FileNotFoundError:
                pass
            store.put(key, archive.read(name))
    with factory() as session:
        old_keys = set(session.scalars(select(Note.storage_key).where(Note.user_id == user_id)))
        provider_ids = {p.id: uuid4() for p in parsed.providers}
        try:
            for table in (AgentProvider, AgentSetting, Lesson, Note, AIProvider):
                session.execute(delete(table).where(table.user_id == user_id))
            session.add_all(
                AIProvider(
                    **(p.model_dump() | {"id": provider_ids[p.id]}),
                    user_id=user_id,
                    api_key_enc=None,
                    key_hint=None,
                    key_kind=None,
                )
                for p in parsed.providers
            )
            session.add_all(
                Note(**(n.model_dump() | {"id": uuid4()}), user_id=user_id) for n in parsed.notes
            )
            session.add_all(Lesson(**item.model_dump(), user_id=user_id) for item in parsed.lessons)
            session.add_all(
                AgentSetting(**s.model_dump(), user_id=user_id) for s in parsed.switches
            )
            session.flush()
            session.add_all(
                AgentProvider(
                    **(a.model_dump() | {"provider_id": provider_ids[a.provider_id]}),
                    user_id=user_id,
                )
                for a in parsed.assignments
            )
            session.commit()
        except SQLAlchemyError:
            session.rollback()
            raise RestoreRefused(
                "the archive's data is inconsistent; nothing was changed"
            ) from None
        for key in old_keys:
            release_blob(session, store, key)
    return {
        "counts": {
            "notes": len(parsed.notes),
            "files": len(parsed.blob_names),
            "lessons": len(parsed.lessons),
            "providers": len(parsed.providers),
            "agent_providers": len(parsed.assignments),
            "agent_settings": len(parsed.switches),
        },
        "providers_needing_key": [
            p.name for p in parsed.providers if PROVIDER_TYPES[p.provider_type].needs_key
        ],
    }
