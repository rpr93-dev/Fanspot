"""NBA team-code normalization.

Canonical codes are Fanspot's (``src/data/teams.ts``): GSW, NO, NYK, SAS,
UTA, WSH, BKN, PHX, OKC, ... ESPN's site API spells some differently (GS, NY,
SA, UTAH) and other sources use NOP/PHO/BRK/CHO/WAS. Both the box-score side
and the caller side go through :func:`normalize_nba_team` so lookups always
meet on one spelling.
"""

from __future__ import annotations

CANONICAL = (
    "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
    "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NO", "NYK",
    "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WSH",
)

_ALIASES = {
    "GS": "GSW", "GOLDENSTATE": "GSW",
    "NY": "NYK", "NYC": "NYK",
    "SA": "SAS", "SAN": "SAS",
    "UTAH": "UTA", "UTH": "UTA",
    "WAS": "WSH", "WASH": "WSH",
    "BRK": "BKN", "BRO": "BKN", "NJ": "BKN", "NJN": "BKN",
    "PHO": "PHX",
    "NOP": "NO", "NOR": "NO", "NOH": "NO",
    "CHO": "CHA", "CHH": "CHA",
    # "LA" is deliberately absent: Clippers or Lakers depending on the source.
}


def normalize_nba_team(code: str | None) -> str:
    """Map any common NBA abbreviation to the Fanspot canonical code.

    Unknown codes pass through upper-cased (never silently remapped to a
    different franchise).
    """
    up = str(code or "").strip().upper().replace(".", "")
    if not up:
        return ""
    if up in CANONICAL:
        return up
    return _ALIASES.get(up, up)
