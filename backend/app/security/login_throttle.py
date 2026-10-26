"""Failed sign-ins per account, so password guessing is slowed even when every request reaches the API
from one address (the web server forwards local sign-ins, so the per-IP rate limit sees one client).

In memory, per API process: enough for the Docker delivery (one process). A deployment with many
instances would keep these counts in the database or a shared cache instead.
"""

import time
from collections import deque
from threading import Lock

MAX_FAILURES = 10
WINDOW_SECONDS = 15 * 60
_MAX_TRACKED = 10_000  # bounded memory: the oldest accounts are forgotten first


class LoginThrottle:
    def __init__(self, max_failures: int = MAX_FAILURES, window: int = WINDOW_SECONDS) -> None:
        self.max_failures = max_failures
        self.window = window
        self._failures: dict[str, deque[float]] = {}
        self._lock = Lock()

    def _recent(self, key: str, now: float) -> deque[float]:
        times = self._failures.get(key, deque())
        while times and times[0] <= now - self.window:
            times.popleft()
        return times

    def wait_seconds(self, key: str) -> int:
        """Seconds until this account may try again; 0 if it may try now."""
        now = time.monotonic()
        with self._lock:
            times = self._recent(key, now)
            if len(times) < self.max_failures:
                return 0
            return max(1, int(times[0] + self.window - now))

    def failed(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            times = self._recent(key, now)
            times.append(now)
            self._failures[key] = times
            if len(self._failures) > _MAX_TRACKED:
                self._failures.pop(next(iter(self._failures)))

    def succeeded(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)


login_throttle = LoginThrottle()
