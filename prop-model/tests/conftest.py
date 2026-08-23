"""Make ``propmodel`` importable no matter where pytest is invoked from.

``propmodel`` lives one level up from this directory and is not an installed
package, so running ``pytest prop-model/tests/`` from the repo root (the CI /
firstmate invocation) needs this path shim.
"""

from __future__ import annotations

import sys
from pathlib import Path

_PKG_ROOT = str(Path(__file__).resolve().parents[1])
if _PKG_ROOT not in sys.path:
    sys.path.insert(0, _PKG_ROOT)
