"""Stat registry: maps each prop stat to the nflverse weekly columns that carry it.

nflfastR/nflverse weekly player stats (``nfl_data_py.import_weekly``) use one row
per player-week with per-stat columns in lowercase snake_case. A "stat" for the
model is defined by:

- which weekly column(s) to read (some stats are a sum — e.g. TDs),
- what kind of value it is (continuous like yards vs count like TDs). STAGE 4
  picks its distributional assumption from this: continuous stats get a normal-ish
  treatment, count stats get a Poisson/shrinkage treatment.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class StatSpec:
    key: str
    label: str
    unit: str
    columns: tuple[str, ...]
    positions: tuple[str, ...]
    kind: str  # "continuous" | "count"
    opportunity_columns: tuple[str, ...] = ()  # columns driving volume (targets, carries, attempts)
    efficiency_denominator: str | None = None  # column to divide value by for per-opportunity efficiency


STATS: dict[str, StatSpec] = {
    "passing_yards": StatSpec(
        key="passing_yards",
        label="Passing Yards",
        unit="yds",
        columns=("passing_yards",),
        positions=("QB",),
        kind="continuous",
        opportunity_columns=("attempts",),
        efficiency_denominator="attempts",
    ),
    "rushing_yards": StatSpec(
        key="rushing_yards",
        label="Rushing Yards",
        unit="yds",
        columns=("rushing_yards",),
        positions=("RB", "QB"),
        kind="continuous",
        opportunity_columns=("carries",),
        efficiency_denominator="carries",
    ),
    "receiving_yards": StatSpec(
        key="receiving_yards",
        label="Receiving Yards",
        unit="yds",
        columns=("receiving_yards",),
        positions=("WR", "TE", "RB"),
        kind="continuous",
        opportunity_columns=("targets",),
        efficiency_denominator="targets",
    ),
    "receptions": StatSpec(
        key="receptions",
        label="Receptions",
        unit="rec",
        columns=("receptions",),
        positions=("WR", "TE", "RB"),
        kind="continuous",
        opportunity_columns=("targets",),
        efficiency_denominator="targets",
    ),
    # "Anytime TD": sum the TD columns that exist for the player. A QB accumulates
    # passing (and occasionally rushing) TDs; a WR only receiving. Treating a
    # missing column as zero is safe because a player never scores in a category
    # they don't line up in — the columns that matter are always present for the
    # players who can score in them.
    "tds": StatSpec(
        key="tds",
        label="Touchdowns",
        unit="td",
        columns=("passing_tds", "rushing_tds", "receiving_tds"),
        positions=("QB", "RB", "WR", "TE"),
        kind="count",
    ),
}

# Convenience aliases so callers can use "pass_yds" / "rec_yds" style keys.
ALIASES: dict[str, str] = {
    "pass_yds": "passing_yards",
    "pass_yards": "passing_yards",
    "rush_yds": "rushing_yards",
    "rushing_yd": "rushing_yards",
    "rec_yds": "receiving_yards",
    "receiving_yd": "receiving_yards",
    "rec": "receptions",
    "anytime_td": "tds",
    "td": "tds",
}


def get_stat(stat: str | StatSpec) -> StatSpec:
    """Resolve a stat key (or pass a :class:`StatSpec` through unchanged).

    Raises ``ValueError`` for unknown keys so callers fail loudly instead of
    silently projecting the wrong column.
    """
    if isinstance(stat, StatSpec):
        return stat
    key = ALIASES.get(stat.lower(), stat.lower())
    try:
        return STATS[key]
    except KeyError:
        raise ValueError(
            f"Unknown stat '{stat}'. Available: {', '.join(sorted(STATS))}"
        ) from None
