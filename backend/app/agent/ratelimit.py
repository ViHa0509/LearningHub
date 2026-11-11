"""A per-minute limit on agent calls for each user, so a loop cannot run up a bill."""

import math
import time
from collections import deque
from collections.abc import Callable
from threading import Lock

WINDOW_SECONDS = 60.0
MAX_KEYS = 1000


class RateLimiter:
    def __init__(self, per_minute: int, clock: Callable[[], float] = time.monotonic) -> None:
        self.per_minute = per_minute
        self._clock = clock
        self._calls: dict[str, deque[float]] = {}
        self._lock = Lock()

    def acquire(self, key: str) -> int | None:
        """Record a call of ``key`` (a user id) and return None, or the seconds to wait when
        that key is over the limit. Each key has its own window."""
        with self._lock:
            now = self._clock()
            calls = self._calls.setdefault(key, deque())
            while calls and now - calls[0] >= WINDOW_SECONDS:
                calls.popleft()
            if len(calls) >= self.per_minute:
                return max(1, math.ceil(WINDOW_SECONDS - (now - calls[0])))
            calls.append(now)
            if len(self._calls) > MAX_KEYS:  # forget users whose window has gone by
                stale = [
                    k for k, c in self._calls.items() if not c or now - c[-1] >= WINDOW_SECONDS
                ]
                for k in stale:
                    del self._calls[k]
            return None
