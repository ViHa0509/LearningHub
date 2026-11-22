"""Content schemas of the interactive tutor (design 2).

The agent fills these through tools; the server builds every surface from them. They are also the
tools' JSON Schemas, so there is no URL or image field: ``extra="forbid"`` refuses unknown keys.
A failure becomes a readable reason (``explain``) the agent sees and fixes.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

MIN_OPTIONS, MAX_OPTIONS = 2, 6
MIN_QUESTIONS, MAX_QUESTIONS = 3, 10
MIN_SECTIONS, MAX_SECTIONS = 3, 8

SectionKind = Literal["concept", "example", "tip", "check"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QuizQuestion(_Strict):
    text: str = Field(
        min_length=1, max_length=600, description="The question, plain text or Markdown."
    )
    options: list[str] = Field(
        description="2 to 6 answer options, each at most 200 characters.",
        json_schema_extra={"minItems": MIN_OPTIONS, "maxItems": MAX_OPTIONS},
    )
    answer: int = Field(
        description="The number of the correct option, counted from 1.",
        json_schema_extra={"minimum": 1},
    )
    explanation: str = Field(
        min_length=1, max_length=800, description="Why the answer is right, in a few sentences."
    )

    @field_validator("options")
    @classmethod
    def _options(cls, value: list[str]) -> list[str]:
        if not MIN_OPTIONS <= len(value) <= MAX_OPTIONS:
            noun = "option" if len(value) == 1 else "options"
            raise ValueError(f"has {len(value)} {noun}; give {MIN_OPTIONS} to {MAX_OPTIONS}")
        for number, option in enumerate(value, start=1):
            if not option.strip():
                raise ValueError(f"option {number} is empty")
            if len(option) > 200:
                raise ValueError(f"option {number} has {len(option)} characters; the limit is 200")
        return value

    @model_validator(mode="after")
    def _answer_in_range(self) -> "QuizQuestion":
        if not 1 <= self.answer <= len(self.options):
            raise ValueError(f"answer {self.answer} is out of range 1-{len(self.options)}")
        return self


class QuizContent(_Strict):
    title: str = Field(min_length=1, max_length=120)
    questions: list[QuizQuestion] = Field(
        description="3 to 10 questions.",
        json_schema_extra={"minItems": MIN_QUESTIONS, "maxItems": MAX_QUESTIONS},
    )

    @field_validator("questions")
    @classmethod
    def _count(cls, value: list[QuizQuestion]) -> list[QuizQuestion]:
        if not MIN_QUESTIONS <= len(value) <= MAX_QUESTIONS:
            raise ValueError(f"has {len(value)} questions; give {MIN_QUESTIONS} to {MAX_QUESTIONS}")
        return value


class Section(_Strict):
    kind: SectionKind = Field(
        description="concept, example or tip need a body; check needs a question."
    )
    heading: str = Field(min_length=1, max_length=120)
    body: str | None = Field(
        default=None, max_length=2000, description="Markdown text; for concept, example and tip."
    )
    question: QuizQuestion | None = Field(default=None, description="Only for a check section.")

    @model_validator(mode="after")
    def _shape(self) -> "Section":
        if self.kind == "check":
            if self.question is None:
                raise ValueError("a check section needs a question")
            if self.body:
                raise ValueError("a check section has a question, not a body")
        else:
            if self.question is not None:
                raise ValueError(f"a {self.kind} section has a body, not a question")
            if self.body is None or not self.body.strip():
                raise ValueError(f"a {self.kind} section needs a body")
        return self


class LessonContent(_Strict):
    title: str = Field(min_length=1, max_length=120)
    sections: list[Section] = Field(
        description="3 to 8 sections.",
        json_schema_extra={"minItems": MIN_SECTIONS, "maxItems": MAX_SECTIONS},
    )

    @field_validator("sections")
    @classmethod
    def _count(cls, value: list[Section]) -> list[Section]:
        if not MIN_SECTIONS <= len(value) <= MAX_SECTIONS:
            raise ValueError(f"has {len(value)} sections; give {MIN_SECTIONS} to {MAX_SECTIONS}")
        return value


_WORDS = {"questions": "question", "sections": "section"}


def _label(loc: tuple[int | str, ...]) -> tuple[str, bool]:
    """A readable place for an error location, and whether it ends on a field name."""
    parts: list[str] = []
    index = 0
    while index < len(loc):
        part = loc[index]
        nxt = loc[index + 1] if index + 1 < len(loc) else None
        if isinstance(part, str) and part in _WORDS and isinstance(nxt, int):
            parts.append(f"{_WORDS[part]} {nxt + 1}")
            index += 2
            continue
        parts.append(str(part))
        index += 1
    return " ".join(parts), bool(loc) and isinstance(loc[-1], str)


def explain(error: ValidationError) -> str:
    """The reasons of a failed validation, one sentence each, for the agent to fix."""
    reasons: list[str] = []
    for item in error.errors():
        message = item["msg"].removeprefix("Value error, ")
        loc = tuple(item["loc"])
        if message.startswith("has "):
            loc = loc[:-1] if loc and isinstance(loc[-1], str) else loc
            label = _label(loc)[0] or "the content"
            reasons.append(f"{label if loc else 'the content'} {message}")
            continue
        label = _label(loc)[0]
        reasons.append(f"{label}: {message}" if label else message)
    return "; ".join(reasons[:6])


def parse_quiz(data: Any) -> QuizContent | str:
    """The quiz, or the reason it was refused."""
    try:
        return QuizContent.model_validate(data)
    except ValidationError as error:
        return explain(error)


def parse_lesson(data: Any) -> LessonContent | str:
    """The lesson, or the reason it was refused."""
    try:
        return LessonContent.model_validate(data)
    except ValidationError as error:
        return explain(error)
