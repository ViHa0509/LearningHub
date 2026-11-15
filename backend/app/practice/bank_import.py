"""Read and check a question bank file (JSON, or a zip with the JSON and its images).

The whole file is checked before anything is stored: every problem found is reported with the
question number (``None`` for the file as a whole). Nothing here touches the database or the
file store.
"""

import json
import zipfile
from collections.abc import Collection
from dataclasses import dataclass, field
from io import BytesIO
from typing import Any

MAX_QUESTIONS = 2000
MAX_TEXT = 2000
MAX_OPTION = 1000
MAX_EXPLANATION = 2000
MAX_TITLE = 120
MIN_OPTIONS = 2
MAX_OPTIONS = 6
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_EXPANDED_BYTES = 50 * 1024 * 1024
MAX_ZIP_ENTRIES = 5000
MAX_ERRORS = 50
CHUNK = 1024 * 1024


class BankFileRefused(Exception):
    """The file cannot be used: ``errors`` is ``[{question, msg}]``; ``status`` 422 or 413."""

    def __init__(self, msg: str, *, question: int | None = None, status: int = 422) -> None:
        super().__init__(msg)
        self.status = status
        self.errors: list[dict[str, Any]] = [{"question": question, "msg": msg}]


@dataclass
class ParsedQuestion:
    number: int
    topic: str
    text: str
    options: list[str]
    answer: int
    critical: bool
    explanation: str | None
    image_name: str | None = None
    image: bytes | None = None
    image_suffix: str | None = None


@dataclass
class ParsedBank:
    title: str
    rules: dict[str, Any]
    questions: list[ParsedQuestion] = field(default_factory=list)


def image_suffix(data: bytes) -> str | None:
    """The file suffix of a PNG, JPEG or WebP image by its magic bytes; None for anything else."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


CONTENT_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}


def _check_zip_name(name: str) -> None:
    if (
        name.startswith(("/", "\\"))
        or "\\" in name
        or ".." in name.split("/")
        or (len(name) > 1 and name[1] == ":")
    ):
        raise BankFileRefused(f"unsafe name in the zip: {name[:80]!r}")


def read_zip_files(data: bytes, *, need_json: bool = False) -> dict[str, bytes]:
    """All files (by name) of a zip; unsafe names, too many entries, duplicate entries and an
    expanded size over 50 MB are refused. With ``need_json`` there must be exactly one .json."""
    try:
        archive = zipfile.ZipFile(BytesIO(data))
    except zipfile.BadZipFile:
        raise BankFileRefused("the file is not a valid zip archive") from None
    with archive:
        infos = [i for i in archive.infolist() if not i.is_dir()]
        if len(archive.infolist()) > MAX_ZIP_ENTRIES:
            raise BankFileRefused("the zip has too many entries")
        for info in archive.infolist():
            _check_zip_name(info.filename)
        if sum(i.file_size for i in infos) > MAX_EXPANDED_BYTES:
            raise BankFileRefused("the zip expands beyond 50 MB", status=413)
        names = [i.filename for i in infos]
        if len(set(names)) != len(names):
            raise BankFileRefused("the zip has duplicate entries")
        if need_json and sum(1 for n in names if n.lower().endswith(".json")) != 1:
            raise BankFileRefused("the zip must hold exactly one .json file")
        left = MAX_EXPANDED_BYTES
        files: dict[str, bytes] = {}
        for info in infos:
            out = bytearray()
            with archive.open(info) as member:  # a lying header cannot exceed the budget
                while chunk := member.read(CHUNK):
                    left -= len(chunk)
                    if left < 0:
                        raise BankFileRefused("the zip expands beyond 50 MB", status=413)
                    out += chunk
            files[info.filename] = bytes(out)
        return files


def read_zip(data: bytes) -> tuple[bytes, dict[str, bytes]]:
    """The JSON file and the other files (by name) of a bank zip."""
    files = read_zip_files(data, need_json=True)
    name = next(n for n in files if n.lower().endswith(".json"))
    return files.pop(name), files


def check_image(name: str, data: bytes) -> tuple[str | None, str | None]:
    """``(suffix, None)`` for a usable image, else ``(None, problem)``."""
    if len(data) > MAX_IMAGE_BYTES:
        return None, f"the image '{name[:80]}' is larger than 2 MB"
    suffix = image_suffix(data)
    if suffix is None:
        return None, f"the image '{name[:80]}' is not a PNG, JPEG or WebP image"
    return suffix, None


def _find_image(name: str, files: dict[str, bytes]) -> bytes | None:
    for candidate in (name, f"images/{name}"):
        if candidate in files:
            return files[candidate]
    base = base_name(name)
    for key, data in files.items():
        if base_name(key) == base:
            return data
    return None


def base_name(name: str) -> str:
    return name.rsplit("/", 1)[-1]


def _text(value: Any, limit: int) -> str | None:
    """The stripped text, or None when it is not a non-empty string within ``limit``."""
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        return None
    return value.strip()


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _check_rules(
    raw: Any, topics: Collection[str], available: int, critical: int, errors: list[dict[str, Any]]
) -> dict[str, Any] | None:
    def bad(msg: str) -> None:
        errors.append({"question": None, "msg": f"rules: {msg}"})

    if not isinstance(raw, dict):
        bad("must be an object")
        return None
    count, minutes, pass_mark = (_int(raw.get(k)) for k in ("questions", "minutes", "pass_mark"))
    before = len(errors)
    if count is None or count < 1:
        bad("'questions' must be a whole number of at least 1")
    elif count > available:
        bad(f"'questions' is {count} but the bank has only {available} questions")
    if minutes is None or minutes < 1:
        bad("'minutes' must be a whole number of at least 1")
    if pass_mark is None or pass_mark < 0 or (count is not None and pass_mark > count):
        bad("'pass_mark' must be a whole number from 0 to 'questions'")
    critical_fails = raw.get("critical_fails", False)
    if not isinstance(critical_fails, bool):
        bad("'critical_fails' must be true or false")
    min_critical = _int(raw.get("min_critical", 0))
    if min_critical is None or min_critical < 0:
        bad("'min_critical' must be a whole number of at least 0")
    elif count is not None and min_critical > count:
        bad("'min_critical' is larger than 'questions'")
    elif min_critical > critical:
        bad(f"'min_critical' is {min_critical} but the bank has only {critical} critical questions")
    per_topic = raw.get("per_topic", {})
    clean: dict[str, int] = {}
    if not isinstance(per_topic, dict):
        bad("'per_topic' must be an object of topic slug to count")
    else:
        for slug, n in per_topic.items():
            if slug not in topics:
                bad(f"'per_topic' names the topic '{str(slug)[:60]}', which the area does not have")
            elif _int(n) is None or n < 0:
                bad(f"'per_topic' count of '{slug}' must be a whole number of at least 0")
            else:
                clean[slug] = n
        if count is not None and sum(clean.values()) > count:
            bad("'per_topic' adds up to more than 'questions'")
    if len(errors) > before or count is None or minutes is None or pass_mark is None:
        return None
    assert isinstance(critical_fails, bool) and min_critical is not None
    return {
        "questions": count,
        "minutes": minutes,
        "pass_mark": pass_mark,
        "critical_fails": critical_fails,
        "min_critical": min_critical,
        "per_topic": clean,
    }


def _check_question(
    raw: Any,
    index: int,
    topics: Collection[str],
    files: dict[str, bytes],
    errors: list[dict[str, Any]],
) -> ParsedQuestion | None:
    if not isinstance(raw, dict):
        errors.append({"question": None, "msg": f"question #{index + 1} is not an object"})
        return None
    number = _int(raw.get("number"))
    label = number if number is not None else None
    problems: list[str] = []
    if number is None or number < 1:
        problems.append("'number' must be a whole number of at least 1")
    topic = raw.get("topic")
    if not isinstance(topic, str) or topic not in topics:
        problems.append(f"the topic '{str(topic)[:60]}' is not a topic of the area")
    text = _text(raw.get("text"), MAX_TEXT)
    if text is None:
        problems.append(f"'text' must be 1 to {MAX_TEXT} characters")
    options_raw = raw.get("options")
    options: list[str] = []
    if not isinstance(options_raw, list) or not MIN_OPTIONS <= len(options_raw) <= MAX_OPTIONS:
        problems.append(f"'options' must be a list of {MIN_OPTIONS} to {MAX_OPTIONS} texts")
    else:
        for position, option in enumerate(options_raw, start=1):
            clean = _text(option, MAX_OPTION)
            if clean is None:
                problems.append(f"option {position} must be 1 to {MAX_OPTION} characters")
            else:
                options.append(clean)
    answer = _int(raw.get("answer"))
    if answer is None or not isinstance(options_raw, list) or not 1 <= answer <= len(options_raw):
        shown = len(options_raw) if isinstance(options_raw, list) else "?"
        problems.append(
            f"'answer' must be a whole number from 1 to the number of options ({shown})"
        )
    critical = raw.get("critical", False)
    if not isinstance(critical, bool):
        problems.append("'critical' must be true or false")
    explanation: str | None = None
    if raw.get("explanation") not in (None, ""):
        explanation = _text(raw.get("explanation"), MAX_EXPLANATION)
        if explanation is None:
            problems.append(f"'explanation' must be at most {MAX_EXPLANATION} characters")
    image: bytes | None = None
    suffix: str | None = None
    image_name: str | None = None
    name = raw.get("image")
    if name not in (None, ""):
        if not isinstance(name, str) or len(name) > 255:
            problems.append("'image' must be a file name of at most 255 characters")
        else:
            image_name = name
            # A picture that is not in the file is added later (POST /api/banks/{id}/images);
            # one that is in the zip is checked now.
            image = _find_image(name, files)
            if image is not None:
                suffix, problem = check_image(name, image)
                if problem is not None:
                    problems.append(problem)
    if problems:
        errors.extend({"question": label, "msg": p} for p in problems)
        return None
    assert number is not None and text is not None and answer is not None
    assert isinstance(topic, str) and isinstance(critical, bool)
    return ParsedQuestion(
        number=number,
        topic=topic,
        text=text,
        options=options,
        answer=answer,
        critical=critical,
        explanation=explanation,
        image_name=image_name,
        image=image,
        image_suffix=suffix,
    )


def parse_bank(
    data: bytes, filename: str, topics: Collection[str]
) -> tuple[ParsedBank | None, list[dict[str, Any]]]:
    """Check the whole file. Returns the bank (None when anything is wrong) and the problems,
    at most 50. Raises ``BankFileRefused`` for a file that cannot be read at all."""
    lower = filename.lower()
    files: dict[str, bytes] = {}
    if lower.endswith(".zip"):
        raw_json, files = read_zip(data)
    elif lower.endswith(".json"):
        raw_json = data
    else:
        raise BankFileRefused("the file must be a .json or a .zip")
    try:
        document = json.loads(raw_json.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        raise BankFileRefused("the JSON file cannot be read") from None
    if not isinstance(document, dict):
        raise BankFileRefused("the JSON file must be an object with 'title', 'rules', 'questions'")
    errors: list[dict[str, Any]] = []
    title = _text(document.get("title"), MAX_TITLE)
    if title is None:
        errors.append({"question": None, "msg": f"'title' must be 1 to {MAX_TITLE} characters"})
    raw_questions = document.get("questions")
    if not isinstance(raw_questions, list) or not raw_questions:
        raise BankFileRefused("'questions' must be a non-empty list")
    if len(raw_questions) > MAX_QUESTIONS:
        raise BankFileRefused(f"at most {MAX_QUESTIONS} questions per bank")
    questions: list[ParsedQuestion] = []
    for index, item in enumerate(raw_questions):
        question = _check_question(item, index, topics, files, errors)
        if question is not None:
            questions.append(question)
    numbers = [q.get("number") for q in raw_questions if isinstance(q, dict)]
    seen: set[int] = set()
    for number in numbers:
        if isinstance(number, int) and not isinstance(number, bool):
            if number in seen:
                errors.append({"question": number, "msg": f"the number {number} is used twice"})
            seen.add(number)
    total = len(raw_questions)
    for number in sorted(seen):
        if not 1 <= number <= total:
            errors.append(
                {"question": number, "msg": f"numbers must run from 1 to {total}; got {number}"}
            )
    critical = sum(1 for q in questions if q.critical)
    rules = _check_rules(document.get("rules"), topics, len(raw_questions), critical, errors)
    if errors or title is None or rules is None:
        return None, errors[:MAX_ERRORS]
    return ParsedBank(title=title, rules=rules, questions=questions), []
