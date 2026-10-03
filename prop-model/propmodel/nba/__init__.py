"""NBA prop-projection pipeline (ESPN box scores -> per-minute model).

Basketball is modeled as *minutes x per-minute rate*, not football-style
per-game volume: playing time is the dominant driver of every counting stat,
and it moves for basketball-specific reasons (rotation role, blowouts,
back-to-backs, preseason load management) that a per-game average can't see.

Modules
-------
- :mod:`.teams`    ESPN <-> Fanspot team-code normalization
- :mod:`.fetcher`  ESPN scoreboard/summary fetch + per-event cache + parser
- :mod:`.players`  name normalization + id/name/team resolver (refuses namesakes)
- :mod:`.model`    minutes, rates, matchup/pace/script factors, NB distribution
- :mod:`.runner`   CLI entry used by ``propmodel.cli --sport nba``
"""
