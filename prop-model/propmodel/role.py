"""Pregame role + workload awareness (starter / backup / availability).

The projection model used to look only at a player's own game log. That is
fine for an entrenched starter and wrong for everyone whose *role* changed
without their history changing: a backup pressed into a starting job still
carries eight mop-up games, so the recency-weighted mean prices him as a
backup on a Sunday he is about to start (the single biggest error in the 2026
season backtest — Tyson Bagent projected 30.7, actual 268.0 as the week-4
starter).

This module turns *timestamped, pregame* role information into an expected
opportunity count (pass attempts / carries / targets) and hands that to the
model, which projects opportunities-first and then converts them to yards or
receptions through a shrunk efficiency. Design rules, in priority order:

1. **Pregame only.** Every depth-chart / availability row carries an
   ``effective`` timestamp. A projection for an event locks to rows whose
   timestamp is on/before the projection cutoff, so post-kickoff news can
   never leak into a "locked" snapshot.
2. **Absence is not role loss.** Missing a game (injury, bye, scratch) must
   not lower a returning starter's expected workload. Opportunity counts come
   from *games played*; the missed week is a gap, not a zero.
3. **Backup → starter scales volume to the position's starter level.** When a
   player is the named/expected starter but their own sample is relief duty,
   expected volume is the starter prior, not the mop-up mean.
4. **Missing or contradictory role info is surfaced, never guessed.** The
   result carries ``uncertain`` + notes; the model widens the interval and
   caps confidence, and a relief-only sample with no role information stays
   flagged as relief duty.
5. **The sportsbook is a diagnostic, not a target.** A large disagreement with
   a posted line is reported as ``market_disagreement`` — the projection is
   never nudged toward the line (that would just launder the book's view and
   destroy the only signal the comparison has).
"""

from __future__ import annotations

import csv
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import pandas as pd

from .data_pipeline import COL_POSITION, COL_SEASON, COL_WEEK, COL_GAMEDAY, _stat_value
from .stats import StatSpec, get_stat

# Role vocabulary shared with the batch schema and the CLI.
ROLE_NAMED_STARTER = "named_starter"
ROLE_BACKUP = "backup"
ROLE_UNKNOWN = "unknown"
_ROLES = {ROLE_NAMED_STARTER, ROLE_BACKUP, ROLE_UNKNOWN}

# Availability vocabulary (ESPN-style).
STATUS_ACTIVE = "active"
STATUS_QUESTIONABLE = "questionable"
STATUS_OUT = "out"
STATUS_UNKNOWN = "unknown"
_STATUSES = {STATUS_ACTIVE, STATUS_QUESTIONABLE, STATUS_OUT, STATUS_UNKNOWN}

# Opportunity volume that marks a game as a *start* rather than relief duty
# (backup / mop-up snaps). Kept here so both the role layer and the model read
# one definition.
START_PROXY_VOLUME: dict[str, float] = {
    "passing_yards": 15,
    "passing_tds": 15,
    "passing_attempts": 15,
    "completions": 15,
    "rushing_yards": 8,
    "receiving_yards": 3,
    "receptions": 3,
}


@dataclass(frozen=True)
class RoleEntry:
    """One timestamped depth-chart / availability row (pregame information)."""

    player: str
    team: str
    position: str
    role: str = ROLE_UNKNOWN
    status: str = STATUS_UNKNOWN
    effective: str = ""  # ISO date or timestamp the row became valid
    source: str | None = None
    depth_rank: int | None = None


@dataclass(frozen=True)
class RoleInfo:
    """Resolved role for one player, as understood strictly before kickoff."""

    player: str
    team: str
    position: str
    role: str = ROLE_UNKNOWN
    status: str = STATUS_UNKNOWN
    expected_starter: bool | None = None
    as_of: str | None = None
    source: str | None = None
    rank: int | None = None
    uncertain: bool = False
    returning: bool = False
    notes: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict:
        return {
            "role": self.role,
            "status": self.status,
            "expected_starter": self.expected_starter,
            "as_of": self.as_of,
            "source": self.source,
            "rank": self.rank,
            "uncertain": self.uncertain,
            "returning": self.returning,
        }


@dataclass(frozen=True)
class ExpectedOpportunities:
    """Opportunity-first expectation for one player + stat."""

    value: float | None            # expected attempts / carries / targets
    column: str | None             # the opportunity column used
    source: str                    # history | role_starter_prior | role_backup | none
    n_start_games: int = 0
    n_games: int = 0
    uncertain: bool = False
    returning: bool = False
    note: str | None = None


# ── Depth-chart / availability loading ─────────────────────────────────────

def _norm_role(value: object) -> str:
    v = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if v in ("starter", "named_starter", "start", "qb1", "rb1", "wr1", "te1"):
        return ROLE_NAMED_STARTER
    if v in ("backup", "second_string", "2nd_string", "reserve", "depth"):
        return ROLE_BACKUP
    if v in ("", "unknown", "none", "nan"):
        return ROLE_UNKNOWN
    return ROLE_UNKNOWN


def _norm_status(value: object) -> str:
    v = str(value or "").strip().lower()
    if v in ("active", "available", "playing", "expected"):
        return STATUS_ACTIVE
    if v in ("questionable", "q", "doubtful", "game_time"):
        return STATUS_QUESTIONABLE
    if v in ("out", "inactive", "ir", "ir_", "suspended"):
        return STATUS_OUT
    if v in ("", "unknown", "none", "nan"):
        return STATUS_UNKNOWN
    return STATUS_UNKNOWN


def parse_depth_chart(raw: Iterable[dict], as_of: str | None = None) -> list[RoleEntry]:
    """Parse depth-chart rows, keeping only rows effective on/before ``as_of``.

    ``raw`` is an iterable of dicts with keys ``player``, ``team`` and
    (optionally) ``position``, ``role``, ``status``, ``effective``, ``source``,
    ``depth_rank``. Rows with an ``effective`` later than ``as_of`` are
    dropped — the freeze an as-of projection promises is only as good as the
    timestamps it honours.
    """
    cutoff = str(as_of) if as_of is not None else None
    out: list[RoleEntry] = []
    for row in raw or []:
        if not isinstance(row, dict):
            continue
        player = str(row.get("player") or "").strip()
        team = str(row.get("team") or "").strip().upper()
        if not player or not team:
            continue
        effective = str(row.get("effective") or row.get("as_of") or "").strip()
        if cutoff and effective and effective > cutoff:
            continue
        rank = row.get("depth_rank")
        try:
            rank_i = int(rank) if rank is not None and str(rank) != "" else None
        except (TypeError, ValueError):
            rank_i = None
        out.append(RoleEntry(
            player=player,
            team=team,
            position=str(row.get("position") or "").strip().upper(),
            role=_norm_role(row.get("role")),
            status=_norm_status(row.get("status")),
            effective=effective,
            source=(str(row.get("source")) if row.get("source") else None),
            depth_rank=rank_i,
        ))
    return out


def load_depth_chart(path: str | Path, as_of: str | None = None) -> list[RoleEntry]:
    """Load a depth chart from a JSON list, a JSON object with ``entries`` or
    a CSV. Returns [] for a missing path so a batch can still run (with role
    uncertainty surfaced) when the feed is unavailable."""
    p = Path(path)
    if not p.exists():
        return []
    text = p.read_text(encoding="utf-8")
    if p.suffix.lower() == ".json":
        data = json.loads(text)
        if isinstance(data, dict):
            data = data.get("entries") or data.get("depth_chart") or []
        return parse_depth_chart(data, as_of=as_of)
    rows = list(csv.DictReader(text.splitlines()))
    return parse_depth_chart(rows, as_of=as_of)


# ── Role resolution ────────────────────────────────────────────────────────

def _same_player(a: str, b: str) -> bool:
    from .players import normalize_name

    return normalize_name(a) == normalize_name(b)


def resolve_role(
    entries: Iterable[RoleEntry],
    player: str,
    team: str,
    position: str,
    as_of: str | None = None,
    batch_role: str | None = None,
    batch_status: str | None = None,
    missed_games: int = 0,
) -> RoleInfo:
    """Resolve one player's pregame role from a depth chart plus a batch hint.

    Precedence: an explicit batch role/status hint (the caller's own data
    pipeline) beats the depth chart; the depth chart beats "unknown". A
    disagreement between the two is recorded as uncertain rather than silently
    picking one — the model then widens and caps.
    """
    team_u = str(team or "").upper()
    pos_u = str(position or "").upper()
    matches = [
        e for e in entries
        if e.team == team_u and _same_player(e.player, player)
        and (not pos_u or not e.position or e.position == pos_u)
    ]
    # Keep the most recent effective row per source.
    matches.sort(key=lambda e: e.effective)
    chart = matches[-1] if matches else None

    hint_role = _norm_role(batch_role) if batch_role is not None else None
    hint_status = _norm_status(batch_status) if batch_status is not None else None

    notes: list[str] = []
    uncertain = False

    chart_role = chart.role if chart else ROLE_UNKNOWN
    chart_status = chart.status if chart else STATUS_UNKNOWN

    if hint_role is not None and hint_role != ROLE_UNKNOWN:
        role = hint_role
        source = "batch"
    elif chart is not None:
        role = chart_role
        source = chart.source or "depth_chart"
    else:
        role = ROLE_UNKNOWN
        source = None

    if hint_role is not None and hint_role != ROLE_UNKNOWN and chart is not None \
            and chart_role != ROLE_UNKNOWN and chart_role != hint_role:
        uncertain = True
        notes.append(
            f"role_conflict: batch says {hint_role}, depth chart says {chart_role} "
            f"(source {chart.source or 'depth_chart'})"
        )

    if hint_status is not None and hint_status != STATUS_UNKNOWN:
        status = hint_status
    else:
        status = chart_status
    if status == STATUS_UNKNOWN and role != ROLE_UNKNOWN:
        status = STATUS_ACTIVE

    if role == ROLE_UNKNOWN and not uncertain:
        notes.append("role_unknown: no pregame starter/availability information")

    expected = None
    if status == STATUS_OUT:
        expected = False
    elif role == ROLE_NAMED_STARTER:
        expected = True
    elif role == ROLE_BACKUP:
        expected = False

    returning = missed_games > 0
    if returning and expected is not False:
        notes.append(
            f"returning_from_absence: {missed_games} missed week(s) in the window — "
            "workload is taken from games played, not the gap"
        )

    return RoleInfo(
        player=player, team=team_u, position=pos_u,
        role=role, status=status, expected_starter=expected,
        as_of=str(as_of) if as_of is not None else None,
        source=source, rank=chart.depth_rank if chart else None,
        uncertain=uncertain, returning=returning, notes=tuple(notes),
    )


# ── Opportunity priors ─────────────────────────────────────────────────────

def starter_volume_prior(
    weekly: pd.DataFrame,
    stat: str | StatSpec,
    as_of: str | None = None,
) -> tuple[float | None, int]:
    """Median per-game opportunity volume of *starter-like* games at this stat's
    positions — the level a promoted backup is expected to reach.

    "Starter-like" reuses :data:`START_PROXY_VOLUME` (QB 15+ attempts, RB 8+
    carries, pass-catcher 3+ targets), then takes the median of those games so
    a few gadget snaps can't drag it. Filtered to games on/before ``as_of``
    when a cutoff is given. Returns ``(prior, n_rows)``.
    """
    spec = get_stat(stat)
    if not spec.opportunity_columns or COL_POSITION not in weekly.columns:
        return None, 0
    col = spec.opportunity_columns[0]
    if col not in weekly.columns:
        return None, 0
    threshold = START_PROXY_VOLUME.get(spec.key)
    if threshold is None:
        return None, 0

    rows = weekly
    if as_of is not None and COL_GAMEDAY in weekly.columns:
        gd = pd.to_datetime(weekly[COL_GAMEDAY], errors="coerce")
        rows = weekly[gd.isna() | (gd <= pd.Timestamp(as_of))]

    rows = rows[rows[COL_POSITION].astype(str).str.upper().isin(spec.positions)]
    if rows.empty:
        return None, 0
    # Prefer rows that actually played (games >= 1) when the column exists.
    if "games" in rows.columns:
        played = rows[pd.to_numeric(rows["games"], errors="coerce").fillna(1) >= 1]
        if not played.empty:
            rows = played
    vols = pd.to_numeric(rows[col], errors="coerce").dropna()
    vols = vols[vols >= threshold]
    if vols.empty:
        return None, 0
    return float(vols.median()), int(len(vols))


def expected_opportunities(
    history,
    role_info: RoleInfo | None,
    stat: str | StatSpec,
    starter_prior: float | None = None,
) -> ExpectedOpportunities:
    """Opportunity-first expectation for one player + stat.

    Reads the player's own opportunity column (games played only), then bends
    it by role:

    - expected starter with a relief-only sample → the position's starter prior;
    - expected starter with a starter sample → the player's own volume
      (a returning starter keeps his pre-absence volume — the gap is not a
      zero);
    - backup / out → the player's own (relief) volume, explicitly flagged;
    - unknown role → the player's own volume, marked ``uncertain``.
    """
    spec = get_stat(stat)
    n = history.n_games if history is not None else 0
    if not spec.opportunity_columns or history is None or history.games is None \
            or history.games.empty:
        return ExpectedOpportunities(None, None, "none", 0, n)
    col = spec.opportunity_columns[0]
    if col not in history.games.columns:
        return ExpectedOpportunities(None, None, "none", 0, n)

    vols = pd.to_numeric(history.games[col], errors="coerce").dropna()
    valid = int(len(vols))
    if valid < 3:
        return ExpectedOpportunities(None, col, "none", 0, n)

    threshold = START_PROXY_VOLUME.get(spec.key)
    n_starts = int((vols >= threshold).sum()) if threshold is not None else 0
    own_volume = float(vols.median())
    relief_only = threshold is not None and n_starts < 2

    role = role_info.role if role_info is not None else ROLE_UNKNOWN
    expected_starter = role_info.expected_starter if role_info is not None else None
    uncertain = bool(role_info.uncertain) if role_info is not None else False
    returning = bool(role_info.returning) if role_info is not None else False
    status = role_info.status if role_info is not None else STATUS_UNKNOWN

    note = None
    if status == STATUS_OUT:
        return ExpectedOpportunities(
            0.0, col, "role_out", n_starts, n, uncertain=False, returning=False,
            note="availability=out: expected opportunities are zero",
        )

    if expected_starter is True and relief_only and starter_prior is not None:
        note = (
            f"backup_to_starter: own sample is relief duty ({n_starts}/{valid} games "
            f"reach start volume) — expected {col} set to the position starter prior "
            f"({starter_prior:.1f})"
        )
        return ExpectedOpportunities(starter_prior, col, "role_starter_prior",
                                     n_starts, n, uncertain=uncertain,
                                     returning=returning, note=note)

    if expected_starter is True:
        note = f"expected_starter: using own {col} volume ({own_volume:.1f})"
        if returning:
            note += " — returning starter; absence not treated as lost workload"
        return ExpectedOpportunities(own_volume, col, "role_starter",
                                     n_starts, n, uncertain=uncertain,
                                     returning=returning, note=note)

    if expected_starter is False and role == ROLE_BACKUP:
        return ExpectedOpportunities(own_volume, col, "role_backup",
                                     n_starts, n, uncertain=uncertain,
                                     returning=returning,
                                     note=f"backup_role: own {col} volume ({own_volume:.1f})")

    # Unknown role: keep the player's own volume but say so. A relief-only
    # sample stays visibly uncertain — the model widens and caps on it.
    if role == ROLE_UNKNOWN:
        uncertain = True
    return ExpectedOpportunities(own_volume, col, "history",
                                 n_starts, n, uncertain=uncertain,
                                 returning=returning, note=note)


def opportunity_uncertainty(role_info: RoleInfo | None, exp: ExpectedOpportunities) -> tuple[bool, list[str]]:
    """Whether a projection should be flagged uncertain, and why.

    Abstention is left to the caller: this returns the reasons so the model
    can widen/cap and the CLI can surface them, WITHOUT silently projecting a
    confident-looking number over contradictory role information.
    """
    reasons: list[str] = []
    if role_info is not None:
        reasons.extend(role_info.notes)
        if role_info.uncertain:
            reasons.append("role_uncertain: pregame role information is missing or contradictory")
    if exp.uncertain and not any("uncertain" in r for r in reasons):
        reasons.append("role_uncertain: pregame role information is missing or contradictory")
    # De-dup while preserving order.
    seen = set()
    out = []
    for r in reasons:
        if r not in seen:
            seen.add(r)
            out.append(r)
    uncertain = bool(role_info.uncertain) or exp.uncertain
    return uncertain, out
