"""Team-code normalization: fantasy/broadcast abbreviations → nflverse codes.

The dashboard (and most fantasy platforms) spell some teams differently than
the nflverse weekly files do — e.g. the Rams are ``LAR`` on ESPN/fantasy but
``LA`` in nflverse ``recent_team``/``opponent_team``. An unnormalized code
silently disables team matching everywhere it is used: player resolution
falls back to name-only (risking wrong-player picks among name collisions),
and ``defense_allowed`` drops the defense's rows so the matchup factor reads
a quiet neutral 1.0.

Normalize at the CLI boundary, before any resolution or rate lookup.
"""

from __future__ import annotations

import pandas as pd

# fantasy/ESPN/broadcast abbreviation -> code used in nflverse weekly data.
# Legacy relocation codes map to their modern home so old rows still match.
TEAM_ALIASES: dict[str, str] = {
    "LAR": "LA",    # Rams (nflverse uses the post-2016 LA code)
    "JAX": "JAC",   # Jaguars
    "WSH": "WAS",   # Washington (ESPN spells it WSH)
    "OAK": "LV",    # Raiders, pre-2020
    "SD": "LAC",    # Chargers, pre-2017
    "STL": "LA",    # Rams, pre-2016
}


def normalize_team_code(code: str, known: set[str] | None = None) -> str:
    """Map one team code to its nflverse spelling.

    ``known`` is the set of codes actually present in the weekly frame; a code
    already present is passed through untouched, so frames that legitimately
    use a fantasy-style code (test fixtures, future schema changes) keep
    matching while unknown-to-the-frame variants get normalized.
    """
    c = str(code).strip().upper()
    if not c:
        return c
    if known is not None and c in known:
        return c
    return TEAM_ALIASES.get(c, c)


def team_codes_in_frame(weekly: pd.DataFrame) -> set[str]:
    """Every team code appearing in the frame's team columns (uppercased)."""
    codes: set[str] = set()
    for col in ("recent_team", "team", "opponent_team"):
        if col in weekly.columns:
            codes |= {str(v).strip().upper() for v in weekly[col].dropna().unique()}
    return codes
