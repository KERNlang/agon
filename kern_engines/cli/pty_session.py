"""Generic pty-driven TUI session.

Engine-agnostic mechanics for driving any interactive CLI agent under a pty
and scraping responses back out. Engine-specific bits (binary, prompt
marker, response marker, chrome filter) live in ``EngineConfig`` instances
in ``configs.py``.

Why this exists: see the kern_engines/README.md design notes. Driving a
real TTY is the only billing channel Anthropic (and similar vendors) can't
distinguish from a human typing.

Design constraints honoured:
- ANSI bytes stripped from input prompts before write (defensive).
- Response-end detection: idle window + presence of response marker since
  the prompt was sent. Hard overall timeout as backstop.
- pyte deliberately NOT used in the hot path — terminal emulators hang on
  certain Claude-TUI byte sequences. Raw bytes + ANSI strip at the end is
  more boring and more robust.
- Cleanup: SIGTERM → bounded grace → SIGKILL → bounded reap → close fd.
  No syscall in the cleanup path can block longer than the configured
  deadlines.
"""

from __future__ import annotations

import errno
import faulthandler
import fcntl
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

# SIGUSR1 → dump all thread stacks. Helps when hunting hangs in the wild.
faulthandler.enable()
try:
    faulthandler.register(signal.SIGUSR1, all_threads=True, chain=False)
except (AttributeError, ValueError):  # pragma: no cover
    pass


# ── errors ────────────────────────────────────────────────────────────────


class PtySessionError(RuntimeError):
    """Generic failure inside a pty-driven CLI session."""


class PtySessionTimeout(PtySessionError):
    """A wait inside the session blew its deadline."""


# ── engine config ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class EngineConfig:
    """Per-engine knobs for ``PtyTuiSession``.

    Adding a new engine means writing one of these and not much else.
    """

    id: str                              # short stable id, e.g. "claude"
    binary: str                          # executable name on PATH
    extra_argv: tuple[str, ...] = ()     # additional argv for chat/exec mode

    # additional argv used when the caller requests agent mode (tools
    # enabled, permissions auto-approved). When empty, agent mode falls
    # back to ``extra_argv``.
    agent_extra_argv: tuple[str, ...] = ()

    # bytes that, when seen in the raw stream, indicate "ready for input"
    prompt_marker_bytes: bytes = b">"

    # text marker (post ANSI strip) that prefixes assistant output
    response_marker: str = "⏺"

    # regex that matches *chrome* lines we want to strip from the response
    # (status bars, spinner text, hints, keybind footers)
    chrome_regex: str = r"(?:Confidence:|automode|⏵⏵|ctx:|/effort|tokens?\))"

    # environment variables to clear before exec — anything that would make
    # the child think it's running inside an existing session of the same agent
    env_strip: tuple[str, ...] = ()

    # tuning
    cols: int = 120
    rows: int = 40
    chunk_size: int = 16384
    poll_interval_s: float = 0.05
    boot_min_ms: int = 1500
    ready_settle_idle_ms: int = 400
    ready_timeout_s: float = 30.0
    response_idle_ms: int = 2000
    # agent-mode flows pause between tool calls; idle threshold needs to
    # be longer so we don't declare "done" while claude is mid-loop.
    agent_response_idle_ms: int = 4000
    sigterm_grace_s: float = 2.0
    reap_grace_s: float = 1.0
    # ask_stream emits at most one delta every stream_emit_interval_s.
    # Set higher to reduce IPC chatter for fast-streaming engines.
    stream_emit_interval_s: float = 0.4


# ── byte plumbing ─────────────────────────────────────────────────────────


_DROP = bytes(
    [b for b in range(0x00, 0x20) if b not in (0x09, 0x0a)]
) + bytes([0x7f])
_DROP_TABLE = bytes.maketrans(_DROP, b"\x20" * len(_DROP))


def sanitize_prompt(prompt: str) -> bytes:
    """Strip ESC/C0 controls (except TAB/LF) and DEL. Returns UTF-8 bytes."""
    return prompt.encode("utf-8", errors="replace").translate(_DROP_TABLE)


_ANSI_CSI = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]")
_ANSI_OSC = re.compile(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")
_ANSI_SHORT = re.compile(rb"\x1b[()*+#%@P-_]?[\x20-\x2f]*[\x30-\x7e]?")
_OTHER_CTRL = re.compile(rb"[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f]")
_NBSP = "\xa0"


def strip_ansi_bytes(buf: bytes) -> str:
    buf = _ANSI_CSI.sub(b"", buf)
    buf = _ANSI_OSC.sub(b"", buf)
    buf = _ANSI_SHORT.sub(b"", buf)
    buf = _OTHER_CTRL.sub(b"", buf)
    return buf.decode("utf-8", errors="replace").replace(_NBSP, " ")


# ── pty helpers ───────────────────────────────────────────────────────────


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def _is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def _read_available(fd: int, max_bytes: int) -> bytes:
    rdy, _, _ = select.select([fd], [], [], 0)
    if not rdy:
        return b""
    try:
        return os.read(fd, max_bytes)
    except (BlockingIOError, InterruptedError):
        return b""
    except OSError as e:
        if e.errno in (errno.EIO, errno.EBADF):
            return b""
        raise


def _terminate(pid: int, fd: int, sigterm_grace_s: float, reap_grace_s: float) -> None:
    """SIGTERM → bounded grace → SIGKILL → bounded reap. Never blocks
    indefinitely, even if some helper of the child keeps the pty open."""
    if _is_alive(pid):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        deadline = time.monotonic() + sigterm_grace_s
        while time.monotonic() < deadline:
            try:
                wpid, _ = os.waitpid(pid, os.WNOHANG)
                if wpid != 0:
                    break
            except ChildProcessError:
                break
            time.sleep(0.05)
        if _is_alive(pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    reap_deadline = time.monotonic() + reap_grace_s
    while time.monotonic() < reap_deadline:
        try:
            wpid, _ = os.waitpid(pid, os.WNOHANG)
            if wpid != 0:
                break
        except ChildProcessError:
            break
        time.sleep(0.05)
    try:
        os.close(fd)
    except OSError:
        pass


# ── response extraction ───────────────────────────────────────────────────


_BOX = re.compile(r"[─-▟\s]+")


def extract_response(post_text: str, cfg: EngineConfig) -> str:
    """Pull the assistant's reply out of the post-send transcript.

    Strategy: find the response marker (e.g. ⏺ for Claude), take everything
    after it up to the first chrome match. Collapse whitespace.

    Fallback (no marker found): dedupe lines, drop chrome and boxes.
    """
    text = re.sub(r"\r\n?", "\n", post_text)
    if cfg.response_marker and cfg.response_marker in text:
        idx = text.index(cfg.response_marker)
        tail = text[idx + len(cfg.response_marker):]
        chrome = re.compile(cfg.chrome_regex)
        m = chrome.search(tail)
        if m:
            tail = tail[: m.start()]
        tail = re.sub(r"[ \t]+", " ", tail)
        tail = re.sub(r"\n{2,}", "\n", tail)
        return tail.strip()
    # fallback path
    chrome = re.compile(cfg.chrome_regex)
    kept: list[str] = []
    seen: set[str] = set()
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        if _BOX.fullmatch(line):
            continue
        if chrome.search(line):
            continue
        key = line[:120]
        if key in seen:
            continue
        seen.add(key)
        kept.append(line)
    return "\n".join(kept).strip()


# ── session ───────────────────────────────────────────────────────────────


@dataclass
class _PumpState:
    idle_ms: float
    booted_ms: float
    bytes_seen: int
    buffer: bytearray


class PtyTuiSession:
    """Long-lived pty-backed TUI session for a generic engine.

    Public API:

        session = PtyTuiSession(CLAUDE)
        try:
            reply = session.ask("hello")
        finally:
            session.close()

    Or as a context manager. Concurrent ``ask()`` calls on the same session
    are forbidden — a Lock serialises them rather than letting them race.
    """

    def __init__(
        self,
        config: EngineConfig,
        *,
        env_overrides: Optional[dict[str, str]] = None,
        mode: str = "exec",
    ) -> None:
        """Spawn a child session.

        ``mode`` selects which argv to exec with:
          - ``"exec"`` (default): plain chat/exec mode → ``config.extra_argv``
          - ``"agent"``: tools + permission bypass → ``config.agent_extra_argv``
            (or ``extra_argv`` if the engine has no separate agent argv)
        """
        if mode not in ("exec", "agent"):
            raise ValueError(f"unknown mode {mode!r}")
        self._cfg = config
        self._mode = mode
        # mode-aware idle threshold used by ask/ask_stream done-detection
        self._response_idle_ms = (
            config.agent_response_idle_ms if mode == "agent" else config.response_idle_ms
        )
        self._lock = threading.Lock()
        self._closed = False
        self._buffer = bytearray()
        self._last_byte_at = 0.0

        self._pid, self._fd = pty.fork()
        if self._pid == 0:
            self._exec_child(env_overrides or {})
            os._exit(127)

        _set_winsize(self._fd, self._cfg.rows, self._cfg.cols)
        try:
            flags = fcntl.fcntl(self._fd, fcntl.F_GETFL)
            fcntl.fcntl(self._fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        except OSError:
            pass
        try:
            self._wait_until_ready()
        except Exception:
            self.close()
            raise

    # ── child setup ───────────────────────────────────────────────

    def _exec_child(self, env_overrides: dict[str, str]) -> None:
        os.environ["TERM"] = "xterm-256color"
        os.environ.setdefault("LANG", "en_US.UTF-8")
        for var in self._cfg.env_strip:
            os.environ.pop(var, None)
        for k, v in env_overrides.items():
            os.environ[k] = v
        argv: tuple[str, ...]
        if self._mode == "agent":
            argv = self._cfg.agent_extra_argv or self._cfg.extra_argv
        else:
            argv = self._cfg.extra_argv
        try:
            os.execvp(self._cfg.binary, [self._cfg.binary, *argv])
        except FileNotFoundError:
            sys.stderr.write(
                f"{self._cfg.binary}: binary not found on PATH\n"
            )

    # ── pump ─────────────────────────────────────────────────────

    def _pump_until(
        self, predicate, *, timeout_s: float, error_label: str
    ) -> None:
        cfg = self._cfg
        start = time.monotonic()
        self._last_byte_at = start
        bytes_at_entry = len(self._buffer)
        while True:
            now = time.monotonic()
            if now - start > timeout_s:
                raise PtySessionTimeout(
                    f"{error_label}: exceeded {timeout_s}s"
                )
            # select-blocking wait gives a hard upper bound on iteration
            # length without a separate time.sleep.
            rdy, _, _ = select.select([self._fd], [], [], cfg.poll_interval_s)
            if rdy:
                chunk = _read_available(self._fd, cfg.chunk_size)
                if chunk:
                    self._buffer.extend(chunk)
                    self._last_byte_at = now
            idle_ms = (now - self._last_byte_at) * 1000.0
            booted_ms = (now - start) * 1000.0
            state = _PumpState(
                idle_ms=idle_ms,
                booted_ms=booted_ms,
                bytes_seen=len(self._buffer) - bytes_at_entry,
                buffer=self._buffer,
            )
            if not _is_alive(self._pid):
                raise PtySessionError(
                    f"{error_label}: child process exited"
                )
            if predicate(state):
                return

    def _wait_until_ready(self) -> None:
        cfg = self._cfg
        marker = cfg.prompt_marker_bytes

        def ready(s: _PumpState) -> bool:
            if s.booted_ms < cfg.boot_min_ms:
                return False
            if s.idle_ms < cfg.ready_settle_idle_ms:
                return False
            return marker in s.buffer

        self._pump_until(ready, timeout_s=cfg.ready_timeout_s, error_label="ready")

    # ── public API ───────────────────────────────────────────────

    def ask(self, prompt: str, timeout: float = 60.0) -> str:
        if self._closed:
            raise PtySessionError("session is closed")
        cfg = self._cfg
        with self._lock:
            pre_len = len(self._buffer)
            payload = sanitize_prompt(prompt) + b"\r"
            os.write(self._fd, payload)

            def done(s: _PumpState) -> bool:
                if s.bytes_seen <= 0:
                    return False
                return s.idle_ms > self._response_idle_ms

            self._pump_until(done, timeout_s=timeout, error_label="ask")
            post_bytes = bytes(self._buffer[pre_len:])
            return extract_response(strip_ansi_bytes(post_bytes), cfg)

    def ask_stream(self, prompt: str, timeout: float = 60.0):
        """Yield response *deltas* as the assistant streams.

        Last yielded value is always the full final response (whatever
        ``ask()`` would have returned). Intermediate yields are best-effort
        snapshots of the in-progress response — Claude's TUI renders
        atomically rather than token-by-token, so most callers should
        expect 1–3 yields per ask, not per token.
        """
        if self._closed:
            raise PtySessionError("session is closed")
        cfg = self._cfg
        with self._lock:
            pre_len = len(self._buffer)
            payload = sanitize_prompt(prompt) + b"\r"
            os.write(self._fd, payload)

            last_emitted = ""
            last_emit_at = time.monotonic()

            def done(s: _PumpState) -> bool:
                nonlocal last_emitted, last_emit_at
                now = time.monotonic()
                if now - last_emit_at >= cfg.stream_emit_interval_s and s.bytes_seen > 0:
                    snapshot = extract_response(
                        strip_ansi_bytes(bytes(self._buffer[pre_len:])), cfg,
                    )
                    if snapshot and snapshot != last_emitted:
                        delta = (
                            snapshot[len(last_emitted):]
                            if snapshot.startswith(last_emitted)
                            else snapshot
                        )
                        if delta:
                            self._pending_chunks.append(delta)
                        last_emitted = snapshot
                        last_emit_at = now
                if s.bytes_seen <= 0:
                    return False
                return s.idle_ms > self._response_idle_ms

            # generator scratch — pump_until calls `done` repeatedly and
            # appends new chunks here; we drain after each pump tick.
            self._pending_chunks: list[str] = []

            try:
                # We can't yield from inside _pump_until (it doesn't know
                # about generators), so run it in slices: pump for one
                # poll-interval at a time, drain chunks, repeat.
                start = time.monotonic()
                while True:
                    elapsed = time.monotonic() - start
                    remaining = timeout - elapsed
                    if remaining <= 0:
                        raise PtySessionTimeout(
                            f"ask_stream: exceeded {timeout}s"
                        )
                    finished = self._pump_slice(
                        done,
                        slice_s=cfg.poll_interval_s * 4,
                        bytes_at_entry=pre_len,
                    )
                    while self._pending_chunks:
                        yield self._pending_chunks.pop(0)
                    if finished:
                        break
                # final flush — extract once more in case the very last
                # tick had data we never snapshotted.
                final = extract_response(
                    strip_ansi_bytes(bytes(self._buffer[pre_len:])), cfg,
                )
                if final and final != last_emitted:
                    delta = (
                        final[len(last_emitted):]
                        if final.startswith(last_emitted)
                        else final
                    )
                    if delta:
                        yield delta
                # Generator return value (consumable via StopIteration.value)
                # — daemon uses this as the canonical clean response so
                # callers don't have to dedupe the noisy TUI redraw chunks.
                return final
            finally:
                self._pending_chunks = []

    def _pump_slice(
        self, predicate, *, slice_s: float, bytes_at_entry: Optional[int] = None,
    ) -> bool:
        """Drive the pump for at most ``slice_s`` seconds. Returns True if
        ``predicate`` was satisfied within the slice, False otherwise.

        ``bytes_at_entry`` overrides the start-of-window byte count so that
        ``bytes_seen`` in the predicate's ``_PumpState`` is cumulative
        across multiple slice calls (useful for ``ask_stream`` where
        callers need 'bytes since prompt was sent', not 'bytes this
        slice'). Defaults to the buffer length at slice entry."""
        cfg = self._cfg
        start = time.monotonic()
        if bytes_at_entry is None:
            bytes_at_entry = len(self._buffer)
        while True:
            now = time.monotonic()
            if now - start > slice_s:
                return False
            rdy, _, _ = select.select([self._fd], [], [], cfg.poll_interval_s)
            if rdy:
                chunk = _read_available(self._fd, cfg.chunk_size)
                if chunk:
                    self._buffer.extend(chunk)
                    self._last_byte_at = now
            if not _is_alive(self._pid):
                raise PtySessionError("ask_stream: child process exited")
            idle_ms = (now - self._last_byte_at) * 1000.0
            state = _PumpState(
                idle_ms=idle_ms,
                booted_ms=(now - start) * 1000.0,
                bytes_seen=len(self._buffer) - bytes_at_entry,
                buffer=self._buffer,
            )
            if predicate(state):
                return True

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        _terminate(
            self._pid, self._fd,
            self._cfg.sigterm_grace_s, self._cfg.reap_grace_s,
        )

    # ── context manager ─────────────────────────────────────────

    def __enter__(self) -> "PtyTuiSession":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def __del__(self) -> None:  # pragma: no cover
        try:
            self.close()
        except Exception:
            pass
