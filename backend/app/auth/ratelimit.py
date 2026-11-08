"""In-memory sliding windows for the auth endpoints, keyed by IP and by email."""

import math
import time
from collections import deque
from collections.abc import Callable, Iterable
from threading import Lock

WINDOW_SECONDS = 60.0
# Forget idle keys when this many are tracked, so the table cannot grow without bound.
MAX_KEYS = 10_000


class AuthLimiter:
    def __init__(self, per_minute: int = 10, clock: Callable[[], float] = time.monotonic) -> None:
        self.per_minute = per_minute
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = Lock()

    def _window(self, key: str, now: float) -> deque[float]:
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= WINDOW_SECONDS:
            hits.popleft()
        return hits

    def _prune(self, now: float) -> None:
        for key in [k for k, v in self._hits.items() if not v or now - v[-1] >= WINDOW_SECONDS]:
            del self._hits[key]

    def hit(self, keys: Iterable[str]) -> int | None:
        """Record one attempt under every key and return None, or return the seconds to wait
        when any key is over the limit (then nothing is recorded)."""
        with self._lock:
            now = self._clock()
            if len(self._hits) > MAX_KEYS:
                self._prune(now)
            windows = [self._window(key, now) for key in keys]
            waits = [
                max(1, math.ceil(WINDOW_SECONDS - (now - w[0])))
                for w in windows
                if len(w) >= self.per_minute
            ]
            if waits:
                return max(waits)
            for window in windows:
                window.append(now)
            return None
