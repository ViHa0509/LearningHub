"""Question banks, practice answers and mock tests (change practice-exams).

A bank is visible to whoever sees its area (own field or published field); only the area's
owner imports or deletes one. Answers and tests are each user's own: another user's test is 404.
The correct answer reaches the browser only in the answer to a practice question and in the
review of a finished test.
"""

import random
import uuid
from datetime import datetime, timedelta
from pathlib import PurePath
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.current import CurrentUser
from app.db import (
    ExamAttempt,
    LearningArea,
    LearningField,
    LearningTopic,
    Question,
    QuestionAnswer,
    QuestionBank,
    User,
    get_session,
)
from app.practice.bank_import import (
    CONTENT_TYPES,
    BankFileRefused,
    base_name,
    check_image,
    parse_bank,
    read_zip_files,
)
from app.practice.exam import DrawQuestion, accepts_answers, draw, score
from app.practice.schemas import (
    AnswerIn,
    AnswerOut,
    AnswersIn,
    BankOut,
    BankRules,
    ExamOut,
    ExamResult,
    ExamSummary,
    QuestionOut,
    ReviewItem,
    TopicCount,
)
from app.routes.guard import require_app_header
from app.storage import FileStore, blob_key, release_blob, sha256_hex

router = APIRouter(tags=["practice"])
guarded = [Depends(require_app_header)]
SessionDep = Annotated[Session, Depends(get_session)]

NOT_OWNER = "Only the owner can change this"
IMAGE_HEADERS = {"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"}


def _store(request: Request) -> FileStore:
    store: FileStore = request.app.state.store
    return store


def _uuid(raw: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"{what} not found") from None


def _area_of(session: Session, user: User, slug: str) -> tuple[LearningArea, LearningField]:
    """The area when the user sees it (own field or published); otherwise 404."""
    area = session.scalar(select(LearningArea).where(LearningArea.slug == slug))
    field = session.get(LearningField, area.field_id) if area is not None else None
    if area is None or field is None or (field.user_id != user.id and not field.published):
        raise HTTPException(status_code=404, detail=f"unknown area '{slug}'")
    return area, field


def _bank_of(
    session: Session, user: User, raw_id: str
) -> tuple[QuestionBank, LearningArea, LearningField]:
    bank = session.get(QuestionBank, _uuid(raw_id, "bank"))
    area = session.get(LearningArea, bank.area_id) if bank is not None else None
    field = session.get(LearningField, area.field_id) if area is not None else None
    if (
        bank is None
        or area is None
        or field is None
        or (field.user_id != user.id and not field.published)
    ):
        raise HTTPException(status_code=404, detail="bank not found")
    return bank, area, field


def _question_of(session: Session, user: User, raw_id: str) -> Question:
    question = session.get(Question, _uuid(raw_id, "question"))
    if question is None:
        raise HTTPException(status_code=404, detail="question not found")
    _bank_of(session, user, str(question.bank_id))  # 404 unless the user sees the bank
    return question


def _bank_out(session: Session, bank: QuestionBank, area: LearningArea) -> BankOut:
    counts = {
        slug: n
        for slug, n in session.execute(
            select(Question.topic_slug, func.count())
            .where(Question.bank_id == bank.id)
            .group_by(Question.topic_slug)
        )
    }
    critical = (
        session.scalar(
            select(func.count())
            .select_from(Question)
            .where(Question.bank_id == bank.id, Question.critical.is_(True))
        )
        or 0
    )
    titles = {
        t.slug: (t.title, t.position)
        for t in session.scalars(select(LearningTopic).where(LearningTopic.area_id == area.id))
    }
    slugs = sorted(counts, key=lambda s: (titles.get(s, ("", 10**9))[1], s))
    missing = (
        session.scalar(
            select(func.count())
            .select_from(Question)
            .where(
                Question.bank_id == bank.id,
                Question.image_name.is_not(None),
                Question.image_key.is_(None),
            )
        )
        or 0
    )
    return BankOut(
        id=str(bank.id),
        area=area.slug,
        title=bank.title,
        rules=BankRules(**bank.rules),
        question_count=bank.question_count,
        critical_count=critical,
        topics=[TopicCount(slug=s, title=titles.get(s, (s, 0))[0], count=counts[s]) for s in slugs],
        images_missing=missing,
        created_at=bank.created_at,
    )


def _last_correct(session: Session, user: User, ids: list[uuid.UUID]) -> dict[uuid.UUID, bool]:
    if not ids:
        return {}
    return {
        qid: correct
        for qid, correct in session.execute(
            select(QuestionAnswer.question_id, QuestionAnswer.last_correct).where(
                QuestionAnswer.user_id == user.id, QuestionAnswer.question_id.in_(ids)
            )
        )
    }


def _question_out(q: Question, last: bool | None) -> QuestionOut:
    return QuestionOut(
        id=str(q.id),
        number=q.number,
        topic=q.topic_slug,
        text=q.text,
        options=list(q.options),
        critical=q.critical,
        has_image=q.image_key is not None,
        last_correct=last,
    )


# --- Banks ----------------------------------------------------------------------------


@router.get("/api/areas/{slug}/banks", response_model=list[BankOut])
def list_banks(
    slug: str, request: Request, session: SessionDep, user: CurrentUser
) -> list[BankOut]:
    if request.app.state.catalog.domain(slug) is not None:
        return []  # a built-in roadmap never has a bank
    area, _ = _area_of(session, user, slug)
    banks = session.scalars(
        select(QuestionBank)
        .where(QuestionBank.area_id == area.id)
        .order_by(QuestionBank.created_at, QuestionBank.id)
    )
    return [_bank_out(session, bank, area) for bank in banks]


@router.post(
    "/api/areas/{slug}/banks", response_model=BankOut, status_code=201, dependencies=guarded
)
def import_bank(
    slug: str,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    file: Annotated[UploadFile, File()],
) -> BankOut:
    if request.app.state.catalog.domain(slug) is not None:
        raise HTTPException(status_code=403, detail="Built-in roadmaps cannot hold a bank")
    area, field = _area_of(session, user, slug)
    if field.user_id != user.id:
        raise HTTPException(status_code=403, detail=NOT_OWNER)
    limit = request.app.state.settings.max_upload_bytes
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status_code=413, detail=f"the file is larger than {limit // (1024 * 1024)} MB"
        )
    name = PurePath(file.filename or "bank.json").name
    topics = set(
        session.scalars(select(LearningTopic.slug).where(LearningTopic.area_id == area.id))
    )
    try:
        parsed, errors = parse_bank(data, name, topics)
    except BankFileRefused as refused:
        raise HTTPException(status_code=refused.status, detail=refused.errors) from None
    if parsed is None:
        raise HTTPException(status_code=422, detail=errors)
    store = _store(request)
    bank = QuestionBank(
        id=uuid.uuid4(),
        area_id=area.id,
        title=parsed.title,
        rules=parsed.rules,
        question_count=len(parsed.questions),
    )
    rows: list[Question] = []
    for q in parsed.questions:
        key = None
        if q.image is not None and q.image_suffix is not None:
            key = blob_key(sha256_hex(q.image), q.image_suffix)
            store.put(key, q.image)  # content-addressed: the same image is the same file
        rows.append(
            Question(
                id=uuid.uuid4(),
                bank_id=bank.id,
                number=q.number,
                topic_slug=q.topic,
                text=q.text,
                options=q.options,
                answer=q.answer,
                critical=q.critical,
                image_name=q.image_name,
                image_key=key,
                explanation=q.explanation,
            )
        )
    session.add(bank)
    session.flush()
    session.add_all(rows)
    session.commit()
    session.refresh(bank)
    return _bank_out(session, bank, area)


@router.delete("/api/banks/{bank_id}", status_code=204, dependencies=guarded)
def delete_bank(bank_id: str, request: Request, session: SessionDep, user: CurrentUser) -> Response:
    bank, _, field = _bank_of(session, user, bank_id)
    if field.user_id != user.id:
        raise HTTPException(status_code=403, detail=NOT_OWNER)
    keys = set(
        session.scalars(
            select(Question.image_key).where(
                Question.bank_id == bank.id, Question.image_key.is_not(None)
            )
        )
    )
    session.delete(bank)
    session.commit()
    for key in keys:
        if key is not None:
            release_blob(session, _store(request), key)
    return Response(status_code=204)


@router.post("/api/banks/{bank_id}/images", dependencies=guarded)
def add_images(
    bank_id: str,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    files: Annotated[list[UploadFile], File()],
) -> dict[str, Any]:
    """Attach pictures to the questions whose ``image`` names them (by file name). Image files
    and zips are taken; an image with a name no question uses is reported as unknown; a name
    sent again replaces the picture (the old file is released when nothing else uses it)."""
    bank, _, field = _bank_of(session, user, bank_id)
    if field.user_id != user.id:
        raise HTTPException(status_code=403, detail=NOT_OWNER)
    limit = request.app.state.settings.max_upload_bytes
    sent: dict[str, bytes] = {}
    for upload in files:
        data = upload.file.read(limit + 1)
        if len(data) > limit:
            raise HTTPException(
                status_code=413, detail=f"a file is larger than {limit // (1024 * 1024)} MB"
            )
        name = PurePath(upload.filename or "").name
        try:
            if name.lower().endswith(".zip"):
                for inner, content in read_zip_files(data).items():
                    sent[base_name(inner)] = content
            elif name:
                sent[name] = data
        except BankFileRefused as refused:
            raise HTTPException(status_code=refused.status, detail=refused.errors) from None
    questions = list(session.scalars(select(Question).where(Question.bank_id == bank.id)))
    wanted: dict[str, list[Question]] = {}
    for q in questions:
        if q.image_name:
            wanted.setdefault(base_name(q.image_name), []).append(q)
    unknown = sorted(n for n in sent if n not in wanted)
    errors: list[dict[str, Any]] = []
    checked: dict[str, str] = {}
    for name in sorted(n for n in sent if n in wanted):
        suffix, problem = check_image(name, sent[name])
        if suffix is None:
            errors.append({"question": wanted[name][0].number, "msg": str(problem)})
        else:
            checked[name] = suffix
    if errors:
        raise HTTPException(status_code=422, detail=errors[:50])
    store = _store(request)
    old: set[str] = set()
    for name, suffix in checked.items():
        key = blob_key(sha256_hex(sent[name]), suffix)
        store.put(key, sent[name])
        for q in wanted[name]:
            if q.image_key and q.image_key != key:
                old.add(q.image_key)
            q.image_key = key
    session.commit()
    for key in old:
        release_blob(session, store, key)
    left = sum(1 for q in questions if q.image_name and q.image_key is None)
    return {"added": sorted(checked), "unknown": unknown, "missing": left}


@router.get("/api/banks/{bank_id}/questions", response_model=list[QuestionOut])
def list_questions(
    bank_id: str,
    session: SessionDep,
    user: CurrentUser,
    topic: str | None = None,
    critical: bool | None = None,
    wrong: bool | None = None,
) -> list[QuestionOut]:
    bank, _, _ = _bank_of(session, user, bank_id)
    query = select(Question).where(Question.bank_id == bank.id).order_by(Question.number)
    if topic is not None:
        query = query.where(Question.topic_slug == topic)
    if critical:
        query = query.where(Question.critical.is_(True))
    if wrong:
        query = query.join(
            QuestionAnswer,
            (QuestionAnswer.question_id == Question.id) & (QuestionAnswer.user_id == user.id),
        ).where(QuestionAnswer.last_correct.is_(False))
    questions = list(session.scalars(query))
    last = _last_correct(session, user, [q.id for q in questions])
    return [_question_out(q, last.get(q.id)) for q in questions]


@router.get("/api/questions/{question_id}/image")
def question_image(
    question_id: str, request: Request, session: SessionDep, user: CurrentUser
) -> Response:
    question = _question_of(session, user, question_id)
    if question.image_key is None:
        raise HTTPException(status_code=404, detail="the question has no image")
    try:
        data = _store(request).get(question.image_key)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="image not found") from None
    suffix = PurePath(question.image_key).suffix
    return Response(
        content=data,
        media_type=CONTENT_TYPES.get(suffix, "application/octet-stream"),
        headers=IMAGE_HEADERS,
    )


# --- Practice ---------------------------------------------------------------------------


def _record(
    session: Session, user: User, question_id: uuid.UUID, correct: bool, now: datetime
) -> None:
    row = session.get(QuestionAnswer, (user.id, question_id))
    if row is None:
        session.add(
            QuestionAnswer(
                user_id=user.id,
                question_id=question_id,
                last_correct=correct,
                times_wrong=0 if correct else 1,
                answered_at=now,
            )
        )
        return
    row.last_correct = correct
    row.times_wrong += 0 if correct else 1
    row.answered_at = now


@router.post("/api/questions/{question_id}/answer", response_model=AnswerOut, dependencies=guarded)
def answer_question(
    question_id: str,
    payload: AnswerIn,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> AnswerOut:
    question = _question_of(session, user, question_id)
    if payload.choice > len(question.options):
        raise HTTPException(status_code=422, detail="the choice is not one of the options")
    correct = payload.choice == question.answer
    _record(session, user, question.id, correct, request.app.state.clock())
    session.commit()
    return AnswerOut(correct=correct, answer=question.answer, explanation=question.explanation)


# --- Mock tests -----------------------------------------------------------------------------


def _exam_of(session: Session, user: User, raw_id: str) -> ExamAttempt:
    exam = session.scalar(
        select(ExamAttempt).where(
            ExamAttempt.id == _uuid(raw_id, "test"), ExamAttempt.user_id == user.id
        )
    )
    if exam is None:
        raise HTTPException(status_code=404, detail="test not found")
    return exam


def _exam_questions(session: Session, exam: ExamAttempt) -> list[Question]:
    ids = [uuid.UUID(i) for i in exam.question_ids]
    by_id = {q.id: q for q in session.scalars(select(Question).where(Question.id.in_(ids)))}
    return [by_id[i] for i in ids if i in by_id]


def _exam_out(session: Session, exam: ExamAttempt) -> ExamOut:
    questions = _exam_questions(session, exam)
    result = None
    if exam.submitted_at is not None:
        review = [
            ReviewItem(
                question_id=str(q.id),
                number=q.number,
                choice=exam.answers.get(str(q.id)),
                answer=q.answer,
                correct=exam.answers.get(str(q.id)) == q.answer,
                explanation=q.explanation,
            )
            for q in questions
        ]
        result = ExamResult(
            score=exam.score or 0,
            total=len(exam.question_ids),
            passed=bool(exam.passed),
            failed_on_critical=list(exam.failed_on_critical),
            review=review,
        )
    return ExamOut(
        id=str(exam.id),
        bank_id=str(exam.bank_id),
        started_at=exam.started_at,
        deadline=exam.deadline,
        submitted_at=exam.submitted_at,
        questions=[_question_out(q, None) for q in questions],
        answers=dict(exam.answers),
        result=result,
    )


def _clean_answers(session: Session, exam: ExamAttempt, given: dict[str, int]) -> dict[str, int]:
    """The answers of ``given`` after checking each is a question of this test and a real option."""
    options = {str(q.id): len(q.options) for q in _exam_questions(session, exam)}
    clean: dict[str, int] = {}
    for key, choice in given.items():
        try:
            qid = str(uuid.UUID(key))
        except ValueError:
            qid = ""
        if qid not in options:
            raise HTTPException(status_code=422, detail=f"{key[:40]} is not a question of the test")
        if choice > options[qid]:
            raise HTTPException(status_code=422, detail="a choice is not one of the options")
        clean[qid] = choice
    return clean


@router.post(
    "/api/banks/{bank_id}/exams", response_model=ExamOut, status_code=201, dependencies=guarded
)
def start_exam(bank_id: str, request: Request, session: SessionDep, user: CurrentUser) -> ExamOut:
    bank, _, _ = _bank_of(session, user, bank_id)
    rows = list(session.scalars(select(Question).where(Question.bank_id == bank.id)))
    if not rows:
        raise HTTPException(status_code=409, detail="the bank has no questions")
    rng: random.Random = getattr(request.app.state, "exam_random", None) or random.SystemRandom()
    drawn = draw(
        [DrawQuestion(str(q.id), q.number, q.topic_slug, q.critical, q.answer) for q in rows],
        bank.rules,
        rng,
    )
    now: datetime = request.app.state.clock()
    exam = ExamAttempt(
        id=uuid.uuid4(),
        user_id=user.id,
        bank_id=bank.id,
        question_ids=drawn,
        answers={},
        started_at=now,
        deadline=now + timedelta(minutes=int(bank.rules["minutes"])),
    )
    session.add(exam)
    session.commit()
    return _exam_out(session, exam)


@router.get("/api/banks/{bank_id}/exams", response_model=list[ExamSummary])
def list_exams(bank_id: str, session: SessionDep, user: CurrentUser) -> list[ExamSummary]:
    bank, _, _ = _bank_of(session, user, bank_id)
    exams = session.scalars(
        select(ExamAttempt)
        .where(ExamAttempt.bank_id == bank.id, ExamAttempt.user_id == user.id)
        .order_by(ExamAttempt.started_at.desc(), ExamAttempt.id)
    )
    return [
        ExamSummary(
            id=str(e.id),
            started_at=e.started_at,
            submitted_at=e.submitted_at,
            score=e.score,
            total=len(e.question_ids),
            passed=e.passed,
        )
        for e in exams
    ]


@router.get("/api/exams/{exam_id}", response_model=ExamOut)
def get_exam(exam_id: str, session: SessionDep, user: CurrentUser) -> ExamOut:
    return _exam_out(session, _exam_of(session, user, exam_id))


@router.put("/api/exams/{exam_id}/answers", dependencies=guarded)
def save_answers(
    exam_id: str, payload: AnswersIn, request: Request, session: SessionDep, user: CurrentUser
) -> dict[str, Any]:
    exam = _exam_of(session, user, exam_id)
    if exam.submitted_at is not None:
        raise HTTPException(status_code=409, detail="the test is finished")
    clean = _clean_answers(session, exam, payload.answers)
    if accepts_answers(request.app.state.clock(), exam.deadline):
        exam.answers = {**exam.answers, **clean}
        session.commit()
    return {"saved": len(exam.answers)}


@router.post("/api/exams/{exam_id}/submit", response_model=ExamOut, dependencies=guarded)
def submit_exam(
    exam_id: str, payload: AnswersIn, request: Request, session: SessionDep, user: CurrentUser
) -> ExamOut:
    exam = _exam_of(session, user, exam_id)
    if exam.submitted_at is not None:
        raise HTTPException(status_code=409, detail="the test is already finished")
    clean = _clean_answers(session, exam, payload.answers)
    now: datetime = request.app.state.clock()
    if accepts_answers(now, exam.deadline):
        exam.answers = {**exam.answers, **clean}
    bank = session.get(QuestionBank, exam.bank_id)
    assert bank is not None
    questions = _exam_questions(session, exam)
    scored = score(
        [DrawQuestion(str(q.id), q.number, q.topic_slug, q.critical, q.answer) for q in questions],
        exam.answers,
        bank.rules,
    )
    for q in questions:
        choice = exam.answers.get(str(q.id))
        if choice is not None:
            _record(session, user, q.id, choice == q.answer, now)
    exam.score = scored.score
    exam.passed = scored.passed
    exam.failed_on_critical = scored.failed_on_critical
    exam.submitted_at = now
    session.commit()
    return _exam_out(session, exam)
