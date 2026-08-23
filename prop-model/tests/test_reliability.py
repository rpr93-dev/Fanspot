"""STAGE 5 tests — retry, disk cache, cached fetcher."""

from __future__ import annotations

import logging
import time

import pandas as pd
import pytest

from propmodel.reliability import DiskCache, cached_fetcher, retry, setup_logging


def test_retry_succeeds_after_failures():
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise ConnectionError("boom")
        return "ok"

    assert retry(flaky, attempts=3, base_delay=0.01, jitter=0, sleep=lambda s: None) == "ok"
    assert calls["n"] == 3


def test_retry_exhausts_and_raises():
    def always_fail():
        raise ValueError("nope")

    with pytest.raises(ValueError):
        retry(always_fail, attempts=2, base_delay=0.01, jitter=0, sleep=lambda s: None)


def test_retry_backoff_delays_double():
    delays = []

    def flaky():
        if len(delays) < 2:
            raise ConnectionError("x")
        return "ok"

    retry(flaky, attempts=3, base_delay=1.0, backoff=2.0, jitter=0, sleep=delays.append)
    assert delays == pytest.approx([1.0, 2.0])


def test_disk_cache_dataframe_roundtrip(tmp_path):
    cache = DiskCache(tmp_path, ttl_seconds=60)
    df = pd.DataFrame({"a": [1, 2], "b": ["x", "y"]})
    cache.set("players", df)
    got = cache.get("players")
    assert isinstance(got, pd.DataFrame)
    assert got.equals(df)
    # No temp files left behind.
    assert list(tmp_path.glob("*.tmp")) == []


def test_disk_cache_json_roundtrip(tmp_path):
    cache = DiskCache(tmp_path, ttl_seconds=60)
    cache.set("lines", {"HOU": 40.5})
    assert cache.get("lines") == {"HOU": 40.5}


def test_disk_cache_ttl_expiry(tmp_path):
    cache = DiskCache(tmp_path, ttl_seconds=-1)  # always expired
    cache.set("k", {"v": 1})
    assert cache.get("k") is None


def test_disk_cache_corrupt_pickle_is_a_miss_not_a_crash(tmp_path):
    """A truncated/garbage .pkl used to raise UnpicklingError on every run,
    wedging the CLI until someone hand-deleted the cache. Regression: the
    corrupt entry is dropped and reads as a miss."""
    cache = DiskCache(tmp_path, ttl_seconds=3600)
    pk = tmp_path / "k.pkl"
    pk.write_bytes(b"not a pickle at all")
    assert cache.get("k") is None
    assert not pk.exists()  # poison removed so set() can rewrite it


def test_disk_cache_corrupt_json_is_a_miss_not_a_crash(tmp_path):
    cache = DiskCache(tmp_path, ttl_seconds=3600)
    js = tmp_path / "k.json"
    js.write_text("{not json", encoding="utf-8")
    assert cache.get("k") is None
    assert not js.exists()
    # And the entry is writable again afterwards.
    cache.set("k", {"v": 1})
    assert cache.get("k") == {"v": 1}


def test_cached_fetcher_refetches_after_cache_corruption(tmp_path):
    """End-to-end wedge regression: fetch once, corrupt the cached frame,
    next call must refetch instead of crashing (or serving garbage)."""
    cache = DiskCache(tmp_path, ttl_seconds=3600)
    calls = {"n": 0}
    df = pd.DataFrame({"season": [2025]})

    def fake_fetcher(seasons):
        calls["n"] += 1
        return df

    wrapped = cached_fetcher(fake_fetcher, cache)
    wrapped([2025])
    # Corrupt every cached pickle.
    for p in tmp_path.glob("*.pkl"):
        p.write_bytes(b"\x00garbage")
    out = wrapped([2025])
    assert calls["n"] == 2
    assert out.equals(df)


def test_cached_fetcher_validator_rejects_stale_entry(tmp_path):
    """A cache hit that fails validation (e.g. an old-schema weekly frame that
    would silently project nobody) must be treated as a miss + refetched."""
    cache = DiskCache(tmp_path, ttl_seconds=3600)
    good = pd.DataFrame({"season": [2025], "ok": [True]})
    bad = pd.DataFrame({"legacy_col": [1]})
    fetched: list[pd.DataFrame] = []

    def fake_fetcher(seasons):
        fetched.append(good)
        return good

    # First call caches the legacy-schema frame (simulating an old run).
    legacy_wrapped = cached_fetcher(lambda s: bad, cache)
    legacy_wrapped([2025])

    wrapped = cached_fetcher(fake_fetcher, cache, validator=lambda df: "ok" in df.columns)
    out = wrapped([2025])
    assert len(fetched) == 1  # refetched
    assert out.equals(good)
    # The refetch replaced the rejected entry — subsequent hits are valid.
    assert wrapped([2025]).equals(good)
    assert len(fetched) == 1


def test_cached_fetcher_fetches_once(tmp_path):
    cache = DiskCache(tmp_path, ttl_seconds=3600)
    calls = {"n": 0}
    df = pd.DataFrame({"season": [2025]})

    def fake_fetcher(seasons):
        calls["n"] += 1
        return df

    wrapped = cached_fetcher(fake_fetcher, cache)
    first = wrapped([2025, 2026])
    second = wrapped([2025, 2026])
    assert calls["n"] == 1
    assert first.equals(second)


def test_setup_logging_idempotent():
    setup_logging(logging.INFO)
    handlers = [h for h in logging.getLogger().handlers if isinstance(h, logging.StreamHandler)]
    before = len(handlers)
    setup_logging(logging.INFO)
    handlers = [h for h in logging.getLogger().handlers if isinstance(h, logging.StreamHandler)]
    assert len(handlers) == before
