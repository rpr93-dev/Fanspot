"""STAGE 5 — Reliability and error handling.

Makes the pipeline safe to run unattended (cron):

- :func:`retry` — exponential backoff + jitter for flaky fetches (nflverse data
  comes from GitHub raw; 429s and transient network errors are normal).
- :class:`DiskCache` — parquet/JSON disk cache so repeat runs don't re-download
  the multi-MB weekly file. Writes go to a temp file then ``os.replace`` so a
  crash mid-write never corrupts a cache entry. The default TTL (24h) reflects
  how often nflverse actually publishes weekly files; the cached entry carries
  an honest freshness stamp, so staleness is visible rather than silent.
- :func:`cached_fetcher` — wraps any ``(seasons) -> DataFrame`` fetcher with the
  disk cache, keyed by the seasons list.
- :func:`setup_logging` — idempotent console logging; low-confidence projections
  are logged at WARN by the CLI.

Rate limiting: nflverse/nfl_data_py does the pulling in one shot; the retry
backoff doubles between attempts, which is the respect-the-server behavior
needed on 429s. A separate token bucket can be layered on later if a source
starts rate-limiting hard.
"""

from __future__ import annotations

import hashlib
import json
import logging
import pickle
import os
import random
import time
from pathlib import Path
from typing import Any, Callable, TypeVar

import pandas as pd

T = TypeVar("T")

logger = logging.getLogger(__name__)


def retry(
    fn: Callable[[], T],
    attempts: int = 3,
    base_delay: float = 1.0,
    backoff: float = 2.0,
    jitter: float = 0.3,
    retry_on: tuple[type[Exception], ...] = (Exception,),
    sleep: Callable[[float], None] = time.sleep,
) -> T:
    """Call ``fn`` with exponential backoff + jitter, retrying on ``retry_on``.

    ``sleep`` is injectable so tests can skip real waiting.
    """
    last_err: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except retry_on as e:
            last_err = e
            if attempt == attempts:
                break
            delay = base_delay * (backoff ** (attempt - 1))
            if jitter > 0:
                delay *= 1.0 + random.uniform(-jitter, jitter)
            logger.warning("Attempt %d/%d failed (%s); retrying in %.1fs", attempt, attempts, e, delay)
            sleep(delay)
    assert last_err is not None
    raise last_err


def _key(*parts: Any) -> str:
    """Stable cache key from simple values."""
    raw = "|".join(str(p) for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


class DiskCache:
    """TTL'd disk cache. DataFrames → pickle; other JSON-able values → json.

    Pickle is used for frames so dtypes round-trip with zero extra dependencies
    (the data is fetched by us, so trusting our own cache file is fine). Swap
    to parquet if pyarrow is ever added — the read/write helpers are isolated
    here. Atomic writes (temp file + ``os.replace``) keep a crash from
    corrupting an entry, which matters when the weekly file is tens of MB and a
    cron job runs on a flaky connection.
    """

    def __init__(self, directory: str | Path, ttl_seconds: int = 24 * 3600):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.ttl_seconds = ttl_seconds

    def _paths(self, key: str) -> tuple[Path, Path]:
        return self.dir / f"{key}.pkl", self.dir / f"{key}.json"

    def _fresh(self, path: Path) -> bool:
        if not path.exists():
            return False
        age = time.time() - path.stat().st_mtime
        return age <= self.ttl_seconds

    def get(self, key: str):
        pk, js = self._paths(key)
        if self._fresh(pk):
            try:
                return pd.read_pickle(pk)
            except Exception as e:  # noqa: BLE001 — corrupt entry must not wedge every run
                logger.warning("Cache entry %s unreadable (%s) — treating as a miss", key, e)
                pk.unlink(missing_ok=True)
                return None
        if self._fresh(js):
            try:
                return json.loads(js.read_text(encoding="utf-8"))
            except Exception as e:  # noqa: BLE001
                logger.warning("Cache entry %s unreadable (%s) — treating as a miss", key, e)
                js.unlink(missing_ok=True)
                return None
        return None

    def set(self, key: str, value: Any) -> None:
        pk, js = self._paths(key)
        if isinstance(value, pd.DataFrame):
            tmp = self.dir / f"{key}.pkl.tmp"
            value.to_pickle(tmp)
            os.replace(tmp, pk)
        else:
            tmp = self.dir / f"{key}.json.tmp"
            tmp.write_text(json.dumps(value, default=str), encoding="utf-8")
            os.replace(tmp, js)

    def clear(self) -> None:
        for f in self.dir.glob("*.tmp"):
            f.unlink(missing_ok=True)
        for f in self.dir.iterdir():
            if f.suffix in (".pkl", ".json"):
                f.unlink(missing_ok=True)


def cached_fetcher(
    fetcher: Callable[[list[int]], pd.DataFrame],
    cache: DiskCache,
    prefix: str = "weekly",
    validator: Callable[[Any], bool] | None = None,
) -> Callable[[list[int]], pd.DataFrame]:
    """Wrap a fetcher so identical season lists hit the disk cache.

    ``validator`` (optional) is called on a cache hit; when it returns False the
    entry is treated as a miss (e.g. a cached frame from an older schema that
    would silently project nobody), and the fetcher runs to replace it.
    """

    def wrapped(seasons: list[int]) -> pd.DataFrame:
        key = _key(prefix, sorted(int(s) for s in seasons))
        hit = cache.get(key)
        if hit is not None and validator is not None and not validator(hit):
            logger.warning("Cached %s for seasons %s failed validation — refetching", prefix, sorted(seasons))
            hit = None
        if hit is not None:
            logger.info("Cache hit for %s (seasons %s)", prefix, sorted(seasons))
            return hit
        logger.info("Cache miss for %s (seasons %s) — fetching", prefix, sorted(seasons))
        df = retry(lambda: fetcher(seasons))
        cache.set(key, df)
        return df

    return wrapped


def setup_logging(level: int = logging.INFO) -> None:
    """Idempotent console logging config (safe to call from CLI + library)."""
    root = logging.getLogger()
    if any(isinstance(h, logging.StreamHandler) for h in root.handlers):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s [%(name)s] %(message)s"))
    root.addHandler(handler)
    root.setLevel(level)
