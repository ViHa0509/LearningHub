"""Drawing a mock test by the bank's rules and scoring it (pure functions, no database)."""

import random
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

GRACE = timedelta(seconds=30)


@dataclass(frozen=True)
class DrawQuestion:
    id: str
    number: int
    topic: str
    critical: bool
    answer: int


def draw(
    questions: Sequence[DrawQuestion], rules: Mapping[str, Any], rng: random.Random
) -> list[str]:
    """The ids of a test in random order.

    First ``min_critical`` questions from the critical ones, then ``per_topic`` counts from the
    non-critical questions of each topic, then the rest from the other non-critical questions
    (topics that ``per_topic`` does not name first, so a named count stays exact) until
    ``questions`` is reached; critical questions only fill what non-critical ones cannot.
    """
    target = min(int(rules["questions"]), len(questions))
    ordered = sorted(questions, key=lambda q: q.number)
    chosen: list[DrawQuestion] = []
    taken: set[str] = set()

    def take(pool: list[DrawQuestion], n: int) -> None:
        room = target - len(chosen)
        pool = [q for q in pool if q.id not in taken]
        for q in rng.sample(pool, min(n, room, len(pool))):
            chosen.append(q)
            taken.add(q.id)

    take([q for q in ordered if q.critical], int(rules.get("min_critical", 0)))
    per_topic: Mapping[str, int] = rules.get("per_topic", {})
    for topic, n in per_topic.items():
        take([q for q in ordered if not q.critical and q.topic == topic], int(n))
    others = [q for q in ordered if not q.critical and q.topic not in per_topic]
    take(others, target - len(chosen))
    take([q for q in ordered if not q.critical], target - len(chosen))
    take([q for q in ordered if q.critical], target - len(chosen))
    rng.shuffle(chosen)
    return [q.id for q in chosen]


@dataclass(frozen=True)
class Scored:
    score: int
    passed: bool
    failed_on_critical: list[int]


def score(
    questions: Sequence[DrawQuestion], answers: Mapping[str, int], rules: Mapping[str, Any]
) -> Scored:
    """Score = the correct answers. Passed when the score reaches the pass mark and, if the
    rules say so, no critical question is wrong or unanswered; ``failed_on_critical`` names those
    questions only when the rules say so."""
    correct = sum(1 for q in questions if answers.get(q.id) == q.answer)
    missed = sorted(q.number for q in questions if q.critical and answers.get(q.id) != q.answer)
    fails = bool(rules.get("critical_fails"))
    passed = correct >= int(rules["pass_mark"]) and not (fails and missed)
    return Scored(score=correct, passed=passed, failed_on_critical=missed if fails else [])


def accepts_answers(now: datetime, deadline: datetime) -> bool:
    """Answers are taken until the deadline plus 30 seconds."""
    return now <= deadline + GRACE
