"""NBA projection engine: minutes x per-minute rate x matchup, NB distribution.

Why not reuse the NFL per-game model
------------------------------------
An NBA counting stat is ``minutes x production per minute``, and the two move
for different reasons. Minutes move with rotation role (promoted to the
starting five, falling out of the rotation), blowouts (starters sit the fourth
quarter of a 20-point game), back-to-backs and preseason load management.
Per-minute production is a stable skill that only needs shrinking when the
sample is thin. Modeling the product keeps each adjustment where it belongs.

Pipeline (per target)
---------------------
1. **Minutes**: recency-weighted mean over recent *played* games (DNPs are
   excluded from the mean). Role-change detection: when the last 3 games all
   share a starter/bench status that differs from the bulk of the window,
   minutes come from games in the new role (``role_factor``). Coach's-decision
   DNPs among the last 10 listings trim expected minutes (rotation risk).
2. **Rate**: per-minute stat rate = sum(w*stat) / sum(w*min), shrunk toward the
   position-group league rate with a pseudo-minutes prior (threes shrink
   hardest, they are the noisiest).
3. **Matchup**: opponent stat allowed per possession vs league (shrunk by
   games, clamped) x pace factor (expected game possessions vs the team's own,
   possessions ~ FGA + 0.44 FTA - OREB + TO). For *points* with a Vegas line,
   the market's implied team total replaces both (it already prices pace and
   defense).
4. **Game script**: a large spread trims starters' minutes (garbage time) and
   nudges deep-bench minutes up; a back-to-back (team played the day before
   the event) trims minutes.
5. **Preseason**: prior-season data with minutes x ``preseason_minutes``.
6. **Distribution**: negative binomial with overdispersion fitted from the
   player's game log (var/mean), shrunk toward a stat default, inflated for
   parameter uncertainty; Poisson when the fit is not overdispersed.
   p10..p90 are discrete NB quantiles; low/high = p10/p90.

Refusals (``refused_reason``): unknown/ambiguous player, fewer than
``min_games`` played games. A namesake is never guessed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd

from ..game_script import GameLines
from ..model import FullProjection, compute_confidence, reliability_score
from ..stats import StatSpec
from .fetcher import season_for_date
from .teams import normalize_nba_team

# ── stat registry ───────────────────────────────────────────────────────────
# Keys MUST match src/lib/propLedger.ts MODEL_STATS_PER_SPORT.NBA so the ledger
# grades model rows: points, rebounds, assists, threes.
NBA_STATS: dict[str, StatSpec] = {
    "points": StatSpec(key="points", label="Points", unit="pts", columns=("pts",), positions=("G", "F", "C"), kind="count"),
    "rebounds": StatSpec(key="rebounds", label="Rebounds", unit="reb", columns=("reb",), positions=("G", "F", "C"), kind="count"),
    "assists": StatSpec(key="assists", label="Assists", unit="ast", columns=("ast",), positions=("G", "F", "C"), kind="count"),
    "threes": StatSpec(key="threes", label="3-Pointers Made", unit="3pm", columns=("fg3m",), positions=("G", "F", "C"), kind="count"),
}
NBA_ALIASES = {
    "pts": "points", "player_points": "points", "point": "points",
    "reb": "rebounds", "rebs": "rebounds", "player_rebounds": "rebounds", "rebound": "rebounds",
    "ast": "assists", "asts": "assists", "player_assists": "assists", "assist": "assists",
    "3pm": "threes", "fg3m": "threes", "three_pointers": "threes", "threes_made": "threes",
    "player_threes": "threes", "3pt": "threes",
}


def get_nba_stat(stat: str | StatSpec) -> StatSpec:
    if isinstance(stat, StatSpec):
        return stat
    key = NBA_ALIASES.get(str(stat).lower(), str(stat).lower())
    try:
        return NBA_STATS[key]
    except KeyError:
        raise ValueError(f"Unknown NBA stat '{stat}'. Available: {', '.join(sorted(NBA_STATS))}") from None


# ── knobs ───────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class NBAWeights:
    min_games: int = 5
    minutes_window: int = 15
    minutes_halflife: float = 5.0
    rate_window: int = 40
    rate_halflife: float = 15.0
    prior_season_weight: float = 0.6       # per season of distance from the event's season
    rate_prior_minutes: dict = field(default_factory=lambda: {
        "points": 150.0, "rebounds": 120.0, "assists": 120.0, "threes": 250.0,
    })
    role_lookback: int = 3
    role_clamp: tuple = (0.75, 1.35)
    dnp_window: int = 10
    dnp_trim: float = 0.5                  # minutes x (1 - dnp_trim * DNP-CD rate)
    opp_window: int = 25
    opp_shrink_games: float = 12.0
    opp_clamp: tuple = (0.88, 1.12)
    pace_window: int = 25
    pace_shrink_games: float = 10.0
    pace_clamp: tuple = (0.94, 1.06)
    market_clamp: tuple = (0.88, 1.14)
    blowout_threshold: float = 7.5
    blowout_slope: float = 0.007           # minutes trim per point of spread beyond threshold
    blowout_cap: float = 0.10
    b2b_starter: float = 0.95
    b2b_other: float = 0.97
    preseason_minutes: float = 0.65
    postseason_minutes_weight: float = 0.5
    dispersion_prior: dict = field(default_factory=lambda: {
        "points": 2.4, "rebounds": 1.6, "assists": 1.6, "threes": 1.25,
    })
    dispersion_shrink_games: float = 12.0
    stale_days: int = 45


# ── distribution ────────────────────────────────────────────────────────────

QUANTILES = (0.10, 0.25, 0.50, 0.75, 0.90)


def nb_quantiles(mean: float, phi: float, qs=QUANTILES) -> list[float]:
    """Discrete quantiles of a negative binomial with mean ``mean`` and
    variance ``phi * mean`` (Poisson when ``phi <= 1``). Monotone in q."""
    mean = max(float(mean), 1e-6)
    phi = max(float(phi), 1.0)
    sd = math.sqrt(mean * phi)
    kmax = int(mean + 25 * sd + 50)
    if phi <= 1.0 + 1e-6:
        log_pmf = lambda k: k * math.log(mean) - mean - math.lgamma(k + 1)  # noqa: E731
    else:
        r = mean / (phi - 1.0)
        p = 1.0 / phi
        lr = math.lgamma(r)
        lp, lq = math.log(p), math.log1p(-p)
        log_pmf = lambda k: math.lgamma(k + r) - lr - math.lgamma(k + 1) + r * lp + k * lq  # noqa: E731
    targets = sorted(qs)
    out: dict[float, float] = {}
    cdf = 0.0
    ti = 0
    for k in range(kmax + 1):
        cdf += math.exp(log_pmf(k))
        while ti < len(targets) and cdf >= targets[ti] - 1e-12:
            out[targets[ti]] = float(k)
            ti += 1
        if ti >= len(targets):
            break
    for q in targets[ti:]:
        out[q] = float(kmax)
    return [out[q] for q in qs]


def nb_prob_over(mean: float, phi: float, line: float) -> float:
    """P(X > line) under the same NB — helper for edge checks/tests."""
    mean = max(float(mean), 1e-6)
    phi = max(float(phi), 1.0)
    k_le = math.floor(line)
    if phi <= 1.0 + 1e-6:
        cdf = sum(math.exp(k * math.log(mean) - mean - math.lgamma(k + 1)) for k in range(k_le + 1))
    else:
        r = mean / (phi - 1.0)
        p = 1.0 / phi
        cdf = sum(math.exp(math.lgamma(k + r) - math.lgamma(r) - math.lgamma(k + 1) + r * math.log(p) + k * math.log1p(-p))
                  for k in range(k_le + 1))
    return max(0.0, min(1.0, 1.0 - cdf))


# ── context (team-level tables, built once per run) ─────────────────────────

def _pos_group(pos) -> str:
    s = str(pos or "").upper()
    for ch in s:
        if ch in "GFC":
            return ch
    return "F"


def _weights(n: int, halflife: float) -> np.ndarray:
    if n <= 0:
        return np.array([])
    return 0.5 ** (np.arange(n) / max(halflife, 1e-6))


def kish_ess(w: np.ndarray) -> float:
    s = float(w.sum())
    s2 = float((w ** 2).sum())
    return (s * s / s2) if s2 > 0 else 0.0


class NBAContext:
    """History up to the cutoff plus derived team-game tables."""

    def __init__(self, frame: pd.DataFrame, cutoff: date | None = None):
        f = frame
        if cutoff is not None and not f.empty:
            f = f[f["game_date"] <= pd.Timestamp(cutoff)]
        self.history = f.reset_index(drop=True)
        self.cutoff = cutoff
        played = self.history[~self.history["dnp"] & (self.history["minutes"].fillna(0) > 0)]
        self.played = played
        if played.empty:
            self.team_games = pd.DataFrame(columns=["game_id", "team", "opponent", "game_date", "season", "poss", "pts", "reb", "ast", "fg3m"])
        else:
            g = played.groupby(["game_id", "team"], as_index=False).agg(
                opponent=("opponent", "first"), game_date=("game_date", "first"), season=("season", "first"),
                fga=("fga", "sum"), fta=("fta", "sum"), oreb=("oreb", "sum"), tov=("tov", "sum"),
                pts=("pts", "sum"), reb=("reb", "sum"), ast=("ast", "sum"), fg3m=("fg3m", "sum"),
            )
            g["poss"] = g["fga"] + 0.44 * g["fta"] - g["oreb"] + g["tov"]
            g = g[g["poss"] > 40]
            self.team_games = g.sort_values("game_date").reset_index(drop=True)
        self.data_through = (
            self.history["game_date"].max().date() if not self.history.empty and pd.notna(self.history["game_date"].max()) else None
        )
        # League baselines: latest season present (falls back to everything).
        tg = self.team_games
        if not tg.empty:
            latest = tg["season"].max()
            ref = tg[tg["season"] == latest]
            if len(ref) < 100:
                ref = tg.tail(600)
        else:
            ref = tg
        self.league_poss = float(ref["poss"].mean()) if not ref.empty else 99.0
        self.league_ppg = float(ref["pts"].mean()) if not ref.empty else 114.0
        self.league_per_poss = {
            c: (float(ref[c].sum() / ref["poss"].sum()) if not ref.empty and ref["poss"].sum() > 0 else None)
            for c in ("pts", "reb", "ast", "fg3m")
        }
        self._rate_prior: dict = {}

    # position-group per-minute rate for a stat column
    def rate_prior(self, col: str, group: str) -> float | None:
        key = (col, group)
        if key not in self._rate_prior:
            p = self.played
            if p.empty:
                self._rate_prior[key] = None
            else:
                latest = p["season"].max()
                ref = p[(p["season"] == latest) & (p["minutes"] >= 10)]
                if len(ref) < 200:
                    ref = p[p["minutes"] >= 10]
                grp = ref[ref["position"].map(_pos_group) == group]
                if len(grp) < 50:
                    grp = ref
                mins = grp["minutes"].sum()
                self._rate_prior[key] = float(grp[col].sum() / mins) if mins > 0 else None
        return self._rate_prior[key]

    def team_pace(self, team: str, w: NBAWeights) -> tuple[float, int]:
        tg = self.team_games
        rows = tg[tg["team"] == team].tail(w.pace_window)
        n = len(rows)
        if n == 0:
            return self.league_poss, 0
        k = w.pace_shrink_games
        return float((rows["poss"].sum() + k * self.league_poss) / (n + k)), n

    def team_ppg(self, team: str, w: NBAWeights) -> float:
        tg = self.team_games
        rows = tg[tg["team"] == team].tail(w.pace_window)
        n = len(rows)
        k = w.pace_shrink_games
        return float((rows["pts"].sum() + k * self.league_ppg) / (n + k))

    def defense_factor(self, opponent: str, col: str, w: NBAWeights) -> tuple[float, int]:
        """Opponent's stat allowed per possession vs league, shrunk + clamped."""
        league = self.league_per_poss.get(col)
        tg = self.team_games
        if not opponent or league is None or tg.empty:
            return 1.0, 0
        rows = tg[tg["opponent"] == opponent].tail(w.opp_window)
        n = len(rows)
        if n == 0 or rows["poss"].sum() <= 0:
            return 1.0, 0
        allowed = float(rows[col].sum() / rows["poss"].sum())
        k = w.opp_shrink_games
        shrunk = (n * allowed + k * league) / (n + k)
        lo, hi = w.opp_clamp
        return float(min(hi, max(lo, shrunk / league))), n

    def team_played_on(self, team: str, day: date) -> bool:
        tg = self.team_games
        if tg.empty or not team:
            return False
        return bool(((tg["team"] == team) & (tg["game_date"] == pd.Timestamp(day))).any())


# ── projection ──────────────────────────────────────────────────────────────

def refusal(player: str, spec: StatSpec, reason: str, n_games: int = 0, note: str | None = None) -> FullProjection:
    return FullProjection(
        player_name=player, stat=spec,
        projection=None, baseline=None, pred_sd=None, low=None, high=None,
        p10=None, p25=None, p50=None, p75=None, p90=None,
        confidence="low", confidence_score=0.0, reliability_score=0,
        n_games=n_games, refused_reason=reason, note=note,
    )


def blowout_minutes_factor(lines: GameLines | None, is_starter: bool, minutes_base: float, w: NBAWeights) -> float:
    if lines is None:
        return 1.0
    s = abs(float(lines.spread or 0.0))
    if s <= w.blowout_threshold:
        return 1.0
    trim = min(w.blowout_cap, w.blowout_slope * (s - w.blowout_threshold))
    if is_starter and minutes_base >= 26:
        return 1.0 - trim
    if minutes_base < 20:
        return 1.0 + 0.5 * trim
    return 1.0 - 0.5 * trim


def project_minutes(games: pd.DataFrame, listed: pd.DataFrame, event_season: int | None, w: NBAWeights) -> dict:
    """Minutes model over a player's games, newest first.

    ``games`` are played games (minutes > 0); ``listed`` are recent box-score
    listings including DNPs. Returns base minutes, role factor, rotation factor
    and the effective starter flag.
    """
    g = games.head(w.minutes_window)
    wts = _weights(len(g), w.minutes_halflife)
    if event_season is not None:
        wts = wts * (w.prior_season_weight ** np.clip(event_season - g["season"].to_numpy(dtype=float), 0, None))
    if "season_type" in g.columns and len(g):
        # Playoff rotations shorten (stars play +3-5 min): half weight so a
        # projection made off the postseason tail isn't inflated.
        st = pd.to_numeric(g["season_type"], errors="coerce").fillna(2).to_numpy()
        wts = wts * np.where(st == 3, w.postseason_minutes_weight, 1.0)
    mins = g["minutes"].to_numpy(dtype=float)
    starters = g["starter"].to_numpy(dtype=bool)
    base = float((wts * mins).sum() / wts.sum()) if wts.sum() > 0 else 0.0
    starter_share = float((wts * starters).sum() / wts.sum()) if wts.sum() > 0 else 0.0

    role_factor = 1.0
    role_change = None
    is_starter = starter_share >= 0.5
    lb = w.role_lookback
    if len(g) >= lb + 3:
        recent = starters[:lb]
        if recent.all() or (~recent).all():
            new_role = bool(recent[0])
            if (new_role and starter_share < 0.5) or (not new_role and starter_share > 0.5):
                mask = starters == new_role
                if mask.sum() >= lb:
                    role_min = float((wts[mask] * mins[mask]).sum() / wts[mask].sum())
                    lo, hi = w.role_clamp
                    role_factor = float(min(hi, max(lo, role_min / base))) if base > 0 else 1.0
                    is_starter = new_role
                    role_change = "promoted to starter" if new_role else "moved to bench"

    lst = listed.head(w.dnp_window)
    dnp_cd = 0
    if not lst.empty:
        reason = lst["dnp_reason"].fillna("").astype(str).str.upper()
        dnp_cd = int((lst["dnp"] & reason.str.contains("COACH")).sum())
    dnp_rate = dnp_cd / max(len(lst), 1)
    rotation_factor = 1.0 - w.dnp_trim * dnp_rate
    return {
        "base": base,
        "role_factor": role_factor,
        "role_change": role_change,
        "rotation_factor": rotation_factor,
        "dnp_cd": dnp_cd,
        "listed": int(len(lst)),
        "is_starter": is_starter,
        "starter_share": starter_share,
    }


def project_rate(games: pd.DataFrame, col: str, prior_rate: float | None, prior_minutes: float,
                 event_season: int | None, w: NBAWeights) -> dict:
    g = games.head(w.rate_window)
    g = g[g[col].notna()]
    wts = _weights(len(g), w.rate_halflife)
    if event_season is not None and len(g):
        wts = wts * (w.prior_season_weight ** np.clip(event_season - g["season"].to_numpy(dtype=float), 0, None))
    mins = g["minutes"].to_numpy(dtype=float)
    vals = g[col].to_numpy(dtype=float)
    wm = float((wts * mins).sum())
    ws = float((wts * vals).sum())
    raw = ws / wm if wm > 0 else 0.0
    if prior_rate is not None:
        rate = (ws + prior_minutes * prior_rate) / (wm + prior_minutes)
    else:
        rate = raw
    # Recent form: last-5 per-minute rate vs the full-window rate (diagnostic).
    r5 = g.head(5)
    m5 = float(r5["minutes"].sum())
    form = (float(r5[col].sum()) / m5) / raw if m5 > 0 and raw > 0 else None
    # Per-game dispersion (variance/mean) of the stat itself.
    if len(vals) >= 2 and wts.sum() > 0:
        mu = float((wts * vals).sum() / wts.sum())
        var = float((wts * (vals - mu) ** 2).sum() / wts.sum()) * len(vals) / max(len(vals) - 1, 1)
        phi_raw = var / mu if mu > 0 else None
        rel_se = (math.sqrt(var) / mu) / math.sqrt(max(kish_ess(wts), 1.0)) if mu > 0 else 0.0
    else:
        phi_raw, rel_se = None, 0.0
    return {
        "rate": rate, "raw_rate": raw, "n": int(len(g)), "ess": kish_ess(wts) if len(wts) else 0.0,
        "form": form, "phi_raw": phi_raw, "rel_se": rel_se,
    }


def project_nba(
    ctx: NBAContext,
    pid: str,
    player: str,
    stat: str | StatSpec,
    team: str,
    opponent: str,
    lines: GameLines | None = None,
    event_date: date | None = None,
    preseason: bool = False,
    w: NBAWeights | None = None,
    extra_warnings: list[str] | None = None,
) -> FullProjection:
    w = w or NBAWeights()
    spec = get_nba_stat(stat)
    col = spec.columns[0]
    team = normalize_nba_team(team)
    opponent = normalize_nba_team(opponent)
    hist = ctx.history
    rows = hist[hist["player_id"] == str(pid)].sort_values("game_date", ascending=False, kind="stable")
    played = rows[~rows["dnp"] & (rows["minutes"].fillna(0) > 0)]
    n = int(len(played))
    if n < w.min_games:
        return refusal(player, spec, f"only {n} NBA games played (need {w.min_games})", n_games=n)

    warnings = list(extra_warnings or [])
    event_season = season_for_date(event_date) if event_date else (int(played["season"].max()) if n else None)
    if not team:
        team = str(played.iloc[0]["team"])

    # 1. minutes
    mp = project_minutes(played, rows, event_season, w)
    base_min = mp["base"]
    role_factor = mp["role_factor"] * mp["rotation_factor"]
    if mp["role_change"]:
        warnings.append(f"role_change: {mp['role_change']} (minutes x{mp['role_factor']:.2f})")
    if mp["dnp_cd"]:
        warnings.append(f"rotation_risk: {mp['dnp_cd']} coach's-decision DNP in last {mp['listed']}")

    # 4. game script: blowout + back-to-back
    blow = blowout_minutes_factor(lines, mp["is_starter"], base_min * mp["role_factor"], w)
    if blow != 1.0:
        warnings.append(f"blowout_minutes: spread {abs(float(lines.spread)):.1f} -> minutes x{blow:.3f}")
    b2b = 1.0
    if event_date is not None and not preseason:
        if ctx.team_played_on(team, event_date - timedelta(days=1)):
            b2b = w.b2b_starter if mp["is_starter"] else w.b2b_other
            warnings.append(f"back_to_back: {team} played {(event_date - timedelta(days=1)).isoformat()} (minutes x{b2b:.2f})")
    pre = w.preseason_minutes if preseason else 1.0
    minutes_proj = base_min * role_factor * blow * b2b * pre

    # 2. rate
    group = _pos_group(played.iloc[0]["position"])
    prior = ctx.rate_prior(col, group)
    rp = project_rate(played, col, prior, float(w.rate_prior_minutes.get(spec.key, 150.0)), event_season, w)
    rate = rp["rate"]

    # 3. matchup
    pace_team, n_pace = ctx.team_pace(team, w)
    pace_opp, _ = ctx.team_pace(opponent, w) if opponent else (pace_team, 0)
    lo, hi = w.pace_clamp
    pace = float(min(hi, max(lo, ((pace_team + pace_opp) / 2.0) / pace_team))) if pace_team > 0 else 1.0
    opp, n_opp = ctx.defense_factor(opponent, col, w)
    opp_ok = n_opp > 0
    market = None
    if spec.key == "points" and lines is not None and lines.total:
        is_fav = lines.favorite is not None and normalize_nba_team(lines.favorite) == team
        margin = float(lines.spread) if is_fav else -float(lines.spread)
        implied = (float(lines.total) + margin) / 2.0
        mlo, mhi = w.market_clamp
        market = float(min(mhi, max(mlo, implied / ctx.team_ppg(team, w))))
        matchup = market
        opp_reported = market
        opp_ok = True
    else:
        matchup = opp * pace
        opp_reported = opp

    baseline = base_min * rate
    mean = minutes_proj * rate * matchup
    script_factor = blow * b2b * (1.0 if market is not None else pace)

    # 6. distribution
    phi0 = float(w.dispersion_prior.get(spec.key, 1.5))
    k = w.dispersion_shrink_games
    phi_raw = rp["phi_raw"]
    phi = ((rp["n"] * phi_raw + k * phi0) / (rp["n"] + k)) if phi_raw is not None else phi0
    phi = float(min(6.0, max(1.0, phi)))
    var = mean * phi + (mean * rp["rel_se"]) ** 2
    if preseason:
        var += (mean * 0.25) ** 2  # preseason minutes are a coin-flip
    phi_eff = var / mean if mean > 0 else phi
    q10, q25, q50, q75, q90 = nb_quantiles(mean, phi_eff) if mean > 0 else [0.0] * 5
    pred_sd = math.sqrt(var) if var > 0 else None

    # confidence / reliability
    last_played = played.iloc[0]["game_date"]
    gap = (event_date - last_played.date()).days if (event_date and pd.notna(last_played)) else 0
    stale = (gap > w.stale_days) and not preseason
    if stale:
        warnings.append(f"stale: last game {gap} days before the event")
    role_stable = mp["role_change"] is None and mp["dnp_cd"] == 0
    conf, conf_score = compute_confidence(
        n_games=rp["n"], ess=rp["ess"], history_ok=True, opp_ok=opp_ok, stale_warn=stale,
        min_games=w.min_games, role_stable=role_stable,
    )
    if preseason:
        warnings.append(f"preseason: prior-season data, minutes x{w.preseason_minutes:.2f}")
        if conf == "high":
            conf = "medium"
        conf_score = min(conf_score, 0.6)
    rel = reliability_score(rp["n"], True, opp_ok, stale, w.min_games, ess=rp["ess"], role_stable=role_stable)

    note_bits = [f"{minutes_proj:.1f} min x {rate:.3f}/min"]
    if market is not None:
        note_bits.append(f"market-implied scoring x{market:.3f}")
    else:
        note_bits.append(f"opp x{opp:.3f} · pace x{pace:.3f}")
    if b2b != 1.0:
        note_bits.append("back-to-back")
    if preseason:
        note_bits.append("preseason-adjusted")
    return FullProjection(
        player_name=player, stat=spec,
        projection=mean, baseline=baseline, pred_sd=pred_sd,
        low=q10, high=q90, p10=q10, p25=q25, p50=q50, p75=q75, p90=q90,
        confidence=conf, confidence_score=conf_score, reliability_score=rel,
        # Games actually in the modeled rate window (<= rate_window), not the
        # whole multi-season log.
        n_games=rp["n"], effective_sample_size=rp["ess"],
        opponent_factor=opp_reported, script_factor=script_factor,
        role_factor=role_factor, recent_form_factor=rp["form"],
        refused_reason=None, note=" · ".join(note_bits), warnings=warnings,
        inputs={
            "player_id": str(pid), "team": team, "opponent": opponent,
            "minutes_base": round(base_min, 2), "minutes_proj": round(minutes_proj, 2),
            "rate": round(rate, 4), "raw_rate": round(rp["raw_rate"], 4), "prior_rate": prior,
            "pace": round(pace, 4), "opp_factor": round(opp, 4), "market_factor": market,
            "blowout": round(blow, 4), "b2b": b2b, "phi": round(phi_eff, 3),
            "is_starter": bool(mp["is_starter"]),
        },
    )
