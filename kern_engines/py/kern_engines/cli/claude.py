"""Public ClaudeCliSession — thin wrapper over the generic PtyTuiSession.

Engine-specific behaviour lives in :mod:`kern_engines.cli.configs`; the
pty plumbing lives in :mod:`kern_engines.cli.pty_session`. This module
exists so callers can keep importing ``ClaudeCliSession`` while we
modularise the internals.
"""

from __future__ import annotations

from typing import Optional

from .configs import CLAUDE
from .pty_session import (
    PtySessionError,
    PtySessionTimeout,
    PtyTuiSession,
)

# Back-compat names
ClaudeSessionError = PtySessionError
ClaudeSessionTimeout = PtySessionTimeout


class ClaudeCliSession(PtyTuiSession):
    """Long-lived pty-backed Claude TUI session.

    Constructed with the Claude engine config baked in. All extension
    points live on the underlying :class:`PtyTuiSession`.
    """

    def __init__(
        self,
        cols: int = 120,
        rows: int = 40,
        *,
        env_overrides: Optional[dict[str, str]] = None,
    ) -> None:
        # cols/rows kept for back-compat with the original signature; the
        # underlying config carries them too. Override here.
        cfg = CLAUDE
        if cols != cfg.cols or rows != cfg.rows:
            from dataclasses import replace
            cfg = replace(cfg, cols=cols, rows=rows)
        super().__init__(cfg, env_overrides=env_overrides)


__all__ = [
    "ClaudeCliSession",
    "ClaudeSessionError",
    "ClaudeSessionTimeout",
]
