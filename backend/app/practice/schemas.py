"""Response and request shapes of the practice routes (see openspec/changes/practice-exams/api.md).
No question shape holds the correct answer; only a finished test's review does."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field


class TopicCount(BaseModel):
    slug: str
    title: str
    count: int


class BankRules(BaseModel):
    questions: int
    minutes: int
    pass_mark: int
    critical_fails: bool
    min_critical: int
    per_topic: dict[str, int]


class BankOut(BaseModel):
    id: str
    area: str
    title: str
    rules: BankRules
    question_count: int
    critical_count: int
    topics: list[TopicCount]
    images_missing: int
    bookmarked_count: int
    created_at: datetime


class QuestionOut(BaseModel):
    id: str
    number: int
    topic: str
    text: str
    options: list[str]
    critical: bool
    has_image: bool
    last_correct: bool | None
    last_choice: int | None = None
    bookmarked: bool = False


Choice = Annotated[int, Field(ge=1, le=6)]


class AnswerIn(BaseModel):
    choice: Choice


class AnswerOut(BaseModel):
    correct: bool
    answer: int
    explanation: str | None


class BookmarkIn(BaseModel):
    bookmarked: bool


class BookmarkOut(BaseModel):
    bookmarked: bool


class AnswersIn(BaseModel):
    answers: dict[str, Choice]


class ReviewItem(BaseModel):
    question_id: str
    number: int
    choice: int | None
    answer: int
    correct: bool
    explanation: str | None


class ExamResult(BaseModel):
    score: int
    total: int
    passed: bool
    failed_on_critical: list[int]
    review: list[ReviewItem]


class ExamOut(BaseModel):
    id: str
    bank_id: str
    started_at: datetime
    deadline: datetime
    submitted_at: datetime | None
    questions: list[QuestionOut]
    answers: dict[str, int]
    result: ExamResult | None


class ExamSummary(BaseModel):
    id: str
    started_at: datetime
    submitted_at: datetime | None
    score: int | None
    total: int
    passed: bool | None
