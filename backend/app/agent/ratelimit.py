"""A per-minute limit on agent calls, so a loop or a stuck page cannot run up a bill."""

import math
import time
from collections import deque
from collections.abc import Callable
from threading import Lock

WINDOW_SECONDS = 60.0


class RateLimiter:
    def __init__(self, per_minute: int, clock: Callable[[], float] = time.monotonic) -> None:
        self.per_minute = per_minute
        self._clock = clock
        self._calls: deque[float] = deque()
        self._lock = Lock()

    def acquire(self) -> int | None:
        """Record a call and return None, or return the seconds to wait when over the limit."""
        with self._lock:
            now = self._clock()
            while self._calls and now - self._calls[0] >= WINDOW_SECONDS:
                self._calls.popleft()
            if len(self._calls) >= self.per_minute:
                return max(1, math.ceil(WINDOW_SECONDS - (now - self._calls[0])))
            self._calls.append(now)
            return None
