#!/usr/bin/env python3
"""TuiProbe (tier 2) — PTY probe of AGON's OWN Ink TUI.

Adapted from ``scripts/claude-tui-probe.py`` (same robustness spine: a
non-blocking ``select()`` read loop, a boot→ready→sent→done state machine,
bounded SIGTERM→SIGKILL→reap teardown, a ``faulthandler`` SIGUSR1 stack dump,
and a hard overall timeout). Two deliberate departures, both mandated by
``.claude/specs/cesar-self-render/spec.md``:

  1. SCREEN-STATE CAPTURE, not ANSI stripping. The Claude probe concatenates
     raw bytes and regex-strips ANSI at the end — that yields a *transcript*
     artifact where stale intermediate text ("Loading") survives next to the
     final text ("Ready") because the cursor-motion / erase sequences that
     would have overwritten it were thrown away. Here every PTY byte is fed
     through a ``pyte`` ``Screen`` + ``ByteStream`` sized to --cols/--rows, and
     we emit the FINAL grid (``screen.display`` joined, per-line trailing-space
     rstrip). That is what the terminal actually shows.

  2. REAL ISOLATION. The child runs under a throwaway ``AGON_HOME`` (mkdtemp)
     AND a separate empty ``cwd`` (mkdtemp), with a minimal throwaway
     ``config.json`` (empty engine roster, onboarding pre-completed). The input
     is restricted to a safelist of NON-dispatching slash commands. v1 is a
     chrome/layout probe and must never trigger engine dispatch.

READY MARKER (spec Open Question, resolved here):
  We anchor "ready" on the string ``AGON`` appearing in the pyte screen state.
  Source: the ChromeBar renders ``<Text color="#f97316" bold>{'AGON'}</Text>``
  at ``packages/cli/src/kern/surfaces/app-views.kern:144`` (chat-mode branch).
  The composer's own chat prompt caret is ``'> '`` at
  ``packages/cli/src/kern/blocks/composer.kern:141`` — but a bare ``>`` is not
  distinctive in a full-screen grid, whereas ``AGON`` uniquely identifies
  agon's fully-rendered chat chrome. Both the ChromeBar and the composer input
  line render together in the same bottom-chrome frame, so ``AGON`` present ==
  the composer is ready for input. We poll the SCREEN STATE (not raw bytes)
  for the marker, per spec requirement 5.

Output: JSON to stdout.
  success -> {"frame": "<final grid>", "durationMs": N, "state": "done"}
  failure -> {"error": "..."}
  ALWAYS exits 0 (model_probe.py convention).

Run:
    python3 scripts/agon-tui-probe.py --debug
    python3 scripts/agon-tui-probe.py --input '/status' --cols 100 --rows 30

DO NOT rely on this touching the real ~/.agon — it deliberately does not.
"""

from __future__ import annotations

import argparse
import errno
import faulthandler
import fcntl
import json
import os
import pty
import select
import shutil
import signal
import struct
import sys
import tempfile
import termios
import time
from dataclasses import dataclass, field
from typing import Optional

# SIGUSR1 → dump every thread's stack to stderr. Useful when hunting hangs.
faulthandler.enable()
try:
    faulthandler.register(signal.SIGUSR1, all_threads=True, chain=False)
except (AttributeError, ValueError):  # pragma: no cover
    pass


# ── pyte import ─────────────────────────────────────────────────────────────
# Prefer the same import path kern_engines uses if that package is importable;
# fall back to a plain ``import pyte``. If pyte is missing entirely, the module
# still loads — main() reports {"error": "pyte not installed"} and exits 0.
_PYTE_AVAILABLE = False
try:
    import pyte  # noqa: F401

    _PYTE_AVAILABLE = True
except Exception:
    _PYTE_AVAILABLE = False


# ── safelist ────────────────────────────────────────────────────────────────
# v1 is a layout probe: only NON-dispatching slash commands are allowed. Any
# input that would route to an engine (chat text, /review, /council, …) is
# refused so the probe can never spend tokens or mutate anything.
_ALLOWED_INPUT_PREFIXES = ("/help", "/status", "/todos", "/plans", "/checkpoints")


def _input_is_safe(text: str) -> bool:
    stripped = text.strip()
    # Reject ANY control character (incl. \n, \r, ESC): the PTY treats a
    # newline as "submit", so '/help x\n/forge y' would smuggle a second,
    # engine-dispatching command past a prefix-only check (agon-review
    # blocking finding). One line, printable characters only.
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in stripped):
        return False
    # Prefix must be the whole command or be followed by a space —
    # '/helpanything' is not '/help'.
    return any(
        stripped == p or stripped.startswith(p + " ")
        for p in _ALLOWED_INPUT_PREFIXES
    )


# ── paths ───────────────────────────────────────────────────────────────────


def _package_root() -> str:
    # <pkg>/py/agon-tui-probe.py → <pkg>/py → <pkg> (works both in the repo
    # worktree at packages/cli/ and in the installed @kernlang/agon package,
    # which ships py/ + dist/ side by side).
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _default_agon_bin() -> str:
    return os.path.join(_package_root(), "dist", "index.js")


# ── pty helpers ─────────────────────────────────────────────────────────────


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def _is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def _terminate(pid: int, grace_s: float) -> None:
    """SIGTERM → bounded grace → SIGKILL → bounded reap. No syscall in this
    path may block longer than the configured deadlines, even if some helper
    the child spawned keeps the pty open."""
    if _is_alive(pid):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        deadline = time.monotonic() + grace_s
        while time.monotonic() < deadline:
            try:
                wpid, _ = os.waitpid(pid, os.WNOHANG)
                if wpid != 0:
                    return
            except ChildProcessError:
                return
            time.sleep(0.05)
        if _is_alive(pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    reap_deadline = time.monotonic() + 1.0
    while time.monotonic() < reap_deadline:
        try:
            wpid, _ = os.waitpid(pid, os.WNOHANG)
            if wpid != 0:
                return
        except ChildProcessError:
            return
        time.sleep(0.05)


# ── config ──────────────────────────────────────────────────────────────────


def _write_throwaway_config(agon_home: str) -> None:
    """Write a minimal throwaway <AGON_HOME>/config.json.

    Shape mirrors the real config's structure (see
    packages/core/src/kern/signals/config.kern + models/types.kern) but carries
    NO real values — only what the probe needs:

      - onboarded: true          → skip the interactive onboarding flow that a
                                    fresh AGON_HOME would otherwise launch
                                    (packages/cli/src/index.ts:207), which would
                                    block the probe forever waiting for input.
      - cesarAutoModePrompted: true + cesarAutoMode: false
                                 → skip the startup "Enable AUTO mode?" MODAL
                                    QUESTION (app.kern:1010 returns early when
                                    this is true). Without it the modal grabs
                                    focus and swallows the scripted keystrokes.
      - engineActivationMode: explicit + forgeEnabledEngines: []
                                 → keep the forge roster empty. NOTE: agon still
                                    DETECTS installed engine CLIs on PATH (the
                                    ChromeBar shows a non-zero "N engines"); the
                                    real dispatch guard is the input safelist,
                                    not the roster. A fully empty detected roster
                                    would require stubbing PATH — out of scope
                                    for a layout probe.
      - isolationMigrationNotified: true
                                 → suppress the one-time workspace-purity banner
                                    (non-blocking, just cleaner frames).
    """
    os.makedirs(agon_home, exist_ok=True)
    config = {
        "onboarded": True,
        "cesarAutoModePrompted": True,
        "cesarAutoMode": False,
        "engineActivationMode": "explicit",
        "forgeEnabledEngines": [],
        "isolationMigrationNotified": True,
    }
    with open(os.path.join(agon_home, "config.json"), "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
        f.write("\n")


# ── screen capture ──────────────────────────────────────────────────────────


class _ScreenCapture:
    """Wraps a pyte Screen+ByteStream. Feeding is defensive: a pyte
    exception can never wedge the probe (the overall signal.alarm ceiling is
    the ultimate backstop, but we also swallow per-chunk feed errors so one
    bad byte sequence doesn't abort the whole capture)."""

    def __init__(self, cols: int, rows: int) -> None:
        self._screen = pyte.Screen(cols, rows)
        self._stream = pyte.ByteStream(self._screen)

    def feed(self, chunk: bytes) -> None:
        try:
            self._stream.feed(chunk)
        except Exception:
            # A malformed sequence must not kill the probe. Drop it; the grid
            # keeps whatever state it had. The alarm ceiling guards true hangs.
            pass

    def grid(self) -> str:
        # screen.display is a list of fixed-width rows (space-padded). Rstrip
        # each line's trailing spaces, then join. Do NOT strip leading spaces —
        # layout/indentation is exactly what a layout probe must preserve.
        try:
            lines = self._screen.display
        except Exception:
            return ""
        return "\n".join(line.rstrip() for line in lines)

    def contains(self, needle: str) -> bool:
        return needle in self.grid()


# ── probe config ────────────────────────────────────────────────────────────


@dataclass
class ProbeConfig:
    cols: int = 120
    rows: int = 40
    chunk_size: int = 16384
    poll_interval_s: float = 0.05
    boot_min_ms: int = 800
    ready_marker: str = "AGON"  # ChromeBar, app-views.kern:144 (see module docstring)
    ready_settle_idle_ms: int = 400
    response_idle_ms: int = 1200
    overall_timeout_s: float = 45.0
    sigterm_grace_s: float = 2.0
    agon_bin: str = field(default_factory=_default_agon_bin)


@dataclass
class ProbeResult:
    frame: str
    duration_ms: int
    state: str
    state_history: list[str]


# ── env ─────────────────────────────────────────────────────────────────────


def _sanitize_child_env(agon_home: str) -> None:
    """Runs in the forked child before exec. Strip session-leak env vars, then
    pin the isolation vars. Called after fork so it mutates the child's copy of
    os.environ only."""
    # Drop anything that would make a child think it is inside an existing
    # Claude Code / agon session, or that points at the real agon home.
    for var in list(os.environ.keys()):
        if var in ("CLAUDECODE",) or var.startswith("CLAUDE_CODE_"):
            os.environ.pop(var, None)
        elif var.startswith("AGON_"):
            # Strip ALL AGON_* — we re-set exactly AGON_HOME below. This clears
            # AGON_CONTINUE / AGON_PERF / AGON_NO_EVENT_LOG etc. from the parent.
            os.environ.pop(var, None)
    os.environ["AGON_HOME"] = agon_home
    os.environ["TERM"] = "xterm-256color"
    os.environ.setdefault("LANG", "en_US.UTF-8")


# ── main probe ──────────────────────────────────────────────────────────────


def run_probe(
    input_text: str,
    cfg: ProbeConfig,
    *,
    debug: Optional[object] = None,
) -> ProbeResult:
    agon_home = tempfile.mkdtemp(prefix="agon-probe-home-")
    child_cwd = tempfile.mkdtemp(prefix="agon-probe-cwd-")
    _write_throwaway_config(agon_home)

    def _dbg(msg: str) -> None:
        if debug is not None:
            debug.write(msg + "\n")
            debug.flush()

    _dbg(f"[setup] AGON_HOME={agon_home}")
    _dbg(f"[setup] cwd={child_cwd}")
    _dbg(f"[setup] agon_bin={cfg.agon_bin}")

    pid, fd = pty.fork()
    if pid == 0:
        # ── child ──
        _sanitize_child_env(agon_home)
        try:
            os.chdir(child_cwd)
        except OSError as e:
            # The throwaway cwd is the isolation boundary — running agon in an
            # inherited directory instead would silently break that contract.
            sys.stderr.write(f"cannot enter isolated cwd {child_cwd}: {e}\n")
            os._exit(126)
        try:
            os.execvp("node", ["node", cfg.agon_bin])
        except FileNotFoundError:
            sys.stderr.write("node binary not found on PATH\n")
            os._exit(127)
        os._exit(127)

    # ── parent ──
    _set_winsize(fd, cfg.rows, cfg.cols)
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    screen = _ScreenCapture(cfg.cols, cfg.rows)
    to_send = input_text.encode("utf-8", errors="replace") + b"\r"

    start = time.monotonic()
    last_byte_at = start
    last_tick_log = start
    got_bytes_since_send = False
    state = "boot"
    state_history: list[str] = [state]

    try:
        while True:
            now = time.monotonic()
            elapsed = now - start
            if elapsed > cfg.overall_timeout_s:
                raise TimeoutError(
                    f"probe timeout {cfg.overall_timeout_s}s in state={state}"
                )

            rdy, _, _ = select.select([fd], [], [], cfg.poll_interval_s)
            chunk = b""
            if rdy:
                try:
                    chunk = os.read(fd, cfg.chunk_size)
                except BlockingIOError:
                    chunk = b""
                except OSError as e:
                    if e.errno in (errno.EIO, errno.EBADF):
                        chunk = b""
                    else:
                        raise
            if chunk:
                screen.feed(chunk)
                last_byte_at = now
                if state == "sent":
                    got_bytes_since_send = True

            idle_ms = (now - last_byte_at) * 1000.0

            if debug is not None and now - last_tick_log >= 1.0:
                _dbg(
                    f"[t={elapsed:5.1f}s {state:5s}] idle={idle_ms:5.0f}ms "
                    f"marker={'Y' if screen.contains(cfg.ready_marker) else 'n'}"
                )
                last_tick_log = now

            if state == "boot":
                # Ready == the ChromeBar marker is on the SCREEN (not just in
                # the raw byte stream) AND the frame has settled for a beat.
                if (
                    elapsed * 1000.0 > cfg.boot_min_ms
                    and screen.contains(cfg.ready_marker)
                    and idle_ms > cfg.ready_settle_idle_ms
                ):
                    state = "ready"
                    state_history.append(state)
                    _dbg(f"[ready] after {elapsed:.2f}s")

            elif state == "ready":
                os.write(fd, to_send)
                state = "sent"
                state_history.append(state)
                _dbg(f"[sent] {input_text!r}")

            elif state == "sent":
                # Done == the post-send render has gone idle. A layout probe
                # only needs the frame to stop changing; the marker must still
                # be present (it always is in chat mode).
                if got_bytes_since_send and idle_ms > cfg.response_idle_ms:
                    state = "done"
                    state_history.append(state)
                    _dbg(f"[done] after {elapsed:.2f}s")
                    break

            if not _is_alive(pid):
                state_history.append("child-exited")
                _dbg("[child-exited]")
                break

        return ProbeResult(
            frame=screen.grid(),
            duration_ms=int((time.monotonic() - start) * 1000.0),
            state=state,
            state_history=state_history,
        )
    finally:
        _terminate(pid, cfg.sigterm_grace_s)
        try:
            os.close(fd)
        except OSError as e:
            _dbg(f"[cleanup] pty fd close failed (already closed?): {e}")
        # Best-effort cleanup of the throwaway dirs.
        for d in (agon_home, child_cwd):
            try:
                shutil.rmtree(d, ignore_errors=True)
            except Exception as e:
                _dbg(f"[cleanup] rmtree {d} failed: {e}")


# ── CLI ─────────────────────────────────────────────────────────────────────


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="PTY probe of agon's own Ink TUI")
    p.add_argument("--input", default="/help", help="scripted input (safelisted)")
    p.add_argument("--cols", type=int, default=120)
    p.add_argument("--rows", type=int, default=40)
    p.add_argument("--timeout", type=float, default=45.0)
    p.add_argument("--agon-bin", default=None, help="path to agon dist/index.js")
    p.add_argument("--debug", action="store_true")
    return p.parse_args()


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj))
    sys.stdout.write("\n")
    sys.stdout.flush()


def main() -> int:
    args = _parse_args()
    debug = sys.stderr if args.debug else None

    if not _PYTE_AVAILABLE:
        _emit({"error": "pyte not installed"})
        return 0

    if not _input_is_safe(args.input):
        _emit(
            {
                "error": (
                    f"refused unsafe input {args.input!r}; allowed prefixes: "
                    + ", ".join(_ALLOWED_INPUT_PREFIXES)
                )
            }
        )
        return 0

    agon_bin = args.agon_bin or _default_agon_bin()
    if not os.path.isfile(agon_bin):
        _emit(
            {
                "error": (
                    f"agon bin not found: {agon_bin} "
                    "(run `npm run build` from the worktree root first)"
                )
            }
        )
        return 0

    cfg = ProbeConfig(
        cols=args.cols,
        rows=args.rows,
        overall_timeout_s=args.timeout,
        agon_bin=agon_bin,
    )

    # HARD BACKSTOP: an OS-level alarm that fires even if the read loop or a
    # pyte feed wedges. The loop enforces cfg.overall_timeout_s on its own; this
    # is the belt-and-suspenders ceiling required by the spec ("the overall
    # signal.alarm ceiling must always fire"). Give it slack over the loop
    # timeout so the loop's own graceful TimeoutError normally wins.
    def _on_alarm(_signum, _frame):
        raise TimeoutError(f"hard alarm ceiling {int(args.timeout) + 8}s fired")

    prev_handler = signal.signal(signal.SIGALRM, _on_alarm)
    signal.alarm(int(args.timeout) + 8)
    try:
        result = run_probe(args.input, cfg, debug=debug)
    except TimeoutError as e:
        _emit({"error": f"timeout: {e}"})
        return 0
    except Exception as e:  # never leak a stack trace to the caller
        _emit({"error": f"{type(e).__name__}: {e}"})
        return 0
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, prev_handler)

    if debug is not None:
        debug.write(
            f"\n--- state ---\n{' -> '.join(result.state_history)}\n"
            f"--- duration ---\n{result.duration_ms}ms\n"
        )
        debug.flush()

    if result.state != "done":
        _emit(
            {
                "error": (
                    f"probe ended in state={result.state} "
                    f"(history: {' -> '.join(result.state_history)})"
                )
            }
        )
        return 0

    _emit(
        {
            "frame": result.frame,
            "durationMs": result.duration_ms,
            "state": result.state,
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
