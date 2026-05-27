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

    # Input chunking — avoid TUI bracketed-paste auto-collapse.
    # Claude 2026 collapses any large burst write as "[Pasted text +N lines,
    # paste again to expand]" and a single Enter no longer submits — it
    # leaves the TUI in paste-staging state. Writing the prompt in small
    # chunks with brief delays defeats the burst-detection heuristic so
    # claude sees the bytes as typed input. 0 disables chunking entirely
    # (engines without paste auto-collapse — most CLIs — keep one-shot
    # writes for speed).
    input_chunk_size: int = 0
    input_chunk_delay_ms: int = 0

    # Wrap the prompt in bracketed-paste markers (ESC[200~ … ESC[201~).
    # When the TUI enables bracketed paste on its terminal (ESC[?2004h on
    # startup — claude does this), the markers tell the TUI "this is one
    # logical paste, not typed input". The TUI captures the whole block
    # as one message regardless of embedded \n, then a single \r submits
    # it. Without this, multi-line prompts (every kern-sight review prompt
    # has embedded \n for system/files/instructions sections) put the TUI
    # in multiline-input mode where \r just adds another newline. Don't
    # combine with input_chunk_size — bracketed paste defeats burst
    # detection on its own.
    use_bracketed_paste: bool = False
    # agent-mode flows pause between tool calls AND between segments of
    # a long response (e.g. "Confidence: 0.97. DRY findings:" → 6s pause
    # → fenced ```json block). 8s is the empirical sweet spot: long
    # enough that the swarm's 140KB prompts don't get extracted
    # mid-segment, short enough that the bare AI-Review (1.5KB prompt)
    # still completes in ~20s instead of feeling sluggish.
    agent_response_idle_ms: int = 8000
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


# CSI sequences split into two classes:
# - "movement" CSIs (cursor positioning, line/screen erase, scroll) separate
#   visually adjacent text. When the TUI wraps a long JSON string across
#   rows, the bytes look like
#     "Off-by-one in loop\x1b[6;1Hcondition causes\x1b[7;1Hreading past"
#   Stripping these to empty would yield
#     "Off-by-one in loopcondition causesreading past"
#   which destroys words. We replace movement CSIs with a single space
#   instead — `re.sub(r"[ \t]+", " ", ...)` in extract_response collapses
#   the doubled-up whitespace, so this is safe.
# - "style" CSIs (color, weight, cursor visibility) never separate words,
#   so they stay stripped to empty.
# Final letter classes per ECMA-48: H/f cursor-position, A-G cursor-move,
# J/K erase, S/T scroll, n device-status (yields visible response in some
# TUIs, but claude's prompt is harmless to space-substitute).
_ANSI_CSI_MOVE = re.compile(rb"\x1b\[[0-?]*[ -/]*[A-HJKSTfn]")
_ANSI_CSI = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]")
_ANSI_OSC = re.compile(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")
_ANSI_SHORT = re.compile(rb"\x1b[()*+#%@P-_]?[\x20-\x2f]*[\x30-\x7e]?")
_OTHER_CTRL = re.compile(rb"[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f]")
_NBSP = "\xa0"


def strip_ansi_bytes(buf: bytes) -> str:
    # IMPORTANT: substitute movement CSIs BEFORE the broader _ANSI_CSI sweep,
    # otherwise the general pattern eats them first and we lose the space.
    buf = _ANSI_CSI_MOVE.sub(b" ", buf)
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


def _dedupe_filter(text: str, chrome: re.Pattern) -> str:
    """Filter chrome lines and dedupe — works whether or not the
    response marker was found.

    Why filter line-by-line instead of cutting at the first chrome
    match: claude's TUI re-renders the whole screen (including the
    status bar with ``ctx:`` and the spinner) BETWEEN streamed
    response chunks. When ANSI cursor positioning is stripped, the
    byte stream looks like
        Confidence: 0.9
        ────────  ← panel divider
        ctx: ?%   ← status bar redraw
        - src/utils/math.ts: divide doesn't guard…
        ────────
        ctx: ?%
        - src/api/users-1.ts: …
    A "cut at first chrome match" rule slices at ``ctx:`` and drops
    every finding after the first chunk. Filtering line-by-line keeps
    the response chunks and drops the interleaved chrome.

    Dedupe (line[:120] as key) collapses TUI redraws of the same
    response segment so we don't return the same finding 3-4 times.
    """
    text = re.sub(r"[─\-]{8,}", "", text)
    lines = text.split("\n")
    kept: list[str] = []
    seen: set[str] = set()
    for raw in lines:
        line = raw.strip()
        # Collapse runs of spaces inside the line — the TUI re-renders
        # text with varying internal whitespace, and "Foo  Bar" vs
        # "Foo Bar" would otherwise be treated as distinct entries.
        line = re.sub(r"\s+", " ", line)
        if not line:
            continue
        if _BOX.fullmatch(line):
            continue
        if chrome.search(line):
            continue
        # Filter common TUI input-bar fragments that aren't in chrome_regex
        # (kept regex specific so it doesn't chop real response prose).
        if line in ("❯", "paste again to expand"):
            continue
        if line.startswith("❯ "):
            continue
        # Full-line dedupe: TUI redraws emit identical bytes each tick,
        # so exact-match dedupe collapses the redraws while preserving
        # any line that's actually unique. (Earlier line[:120] prefix
        # match was too aggressive — two findings sharing the same
        # leading "- src/foo.ts:" got collapsed to one.)
        if line in seen:
            continue
        seen.add(line)
        kept.append(line)
    return "\n".join(kept).strip()


def extract_response(post_text: str, cfg: EngineConfig) -> str:
    """Pull the assistant's reply out of the post-send transcript.

    Strategy: find the LAST occurrence of the response marker (e.g. ⏺
    for Claude), take everything after it, then filter chrome lines +
    dedupe. When no marker is present (rare — usually means claude
    bailed before printing a response), filter the entire post-send
    transcript instead.
    """
    text = re.sub(r"\r\n?", "\n", post_text)
    chrome = re.compile(cfg.chrome_regex)
    if cfg.response_marker and cfg.response_marker in text:
        idx = text.rindex(cfg.response_marker)
        tail = text[idx + len(cfg.response_marker):]
        return _dedupe_filter(tail, chrome)
    return _dedupe_filter(text, chrome)


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
        extra_argv: tuple[str, ...] = (),
    ) -> None:
        """Spawn a child session.

        ``mode`` selects which argv to exec with:
          - ``"exec"`` (default): plain chat/exec mode → ``config.extra_argv``
          - ``"agent"``: tools + permission bypass → ``config.agent_extra_argv``
            (or ``extra_argv`` if the engine has no separate agent argv)

        ``extra_argv`` are caller-supplied launch flags appended AFTER the
        config argv (e.g. agon forwarding ``--model opus --effort high`` so the
        interactive subscription path honors a /models pick, matching the
        ``--print`` fallback). Empty by default → the engine uses its own config.
        """
        if mode not in ("exec", "agent"):
            raise ValueError(f"unknown mode {mode!r}")
        self._cfg = config
        self._mode = mode
        self._extra_argv = tuple(extra_argv)
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
        # Caller-supplied launch flags (model/effort) follow the config argv.
        argv = (*argv, *self._extra_argv)
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

    def _drain_until_idle(self, idle_ms: int, max_ms: int) -> None:
        """Pump the read buffer until it's been idle for ``idle_ms``, or
        ``max_ms`` total elapsed — whichever comes first.

        Used after a bracketed-paste write to let the TUI fully render
        its "[Pasted text …]" placeholder before we send Enter. Without
        this, the \\r can arrive mid-render and get dropped — claude
        stays parked on the staged paste and never submits.
        """
        cfg = self._cfg
        start = time.monotonic()
        self._last_byte_at = start
        while True:
            now = time.monotonic()
            if (now - start) * 1000.0 >= max_ms:
                return
            if (now - self._last_byte_at) * 1000.0 >= idle_ms:
                return
            rdy, _, _ = select.select([self._fd], [], [], cfg.poll_interval_s)
            if rdy:
                chunk = _read_available(self._fd, cfg.chunk_size)
                if chunk:
                    self._buffer.extend(chunk)
                    self._last_byte_at = now
            if not _is_alive(self._pid):
                return

    def _write_all(self, data: bytes, timeout_s: float = 5.0) -> None:
        """Write every byte of ``data`` to the pty, handling EAGAIN and
        partial writes.

        The pty fd is non-blocking (set in ``__init__`` via O_NONBLOCK).
        os.write on a non-blocking fd may:
        - write fewer bytes than requested (returns actual count), or
        - raise BlockingIOError when the kernel input buffer is full.

        macOS pty input buffers are small (~1-2KB). A multi-KB prompt
        plus ESC[200~/ESC[201~ markers easily saturates the buffer, and
        the trailing \\r write fails with EAGAIN. Wait on select for
        writable, retry, with a bounded timeout so a dead child can't
        hang us forever.
        """
        deadline = time.monotonic() + timeout_s
        while data:
            try:
                n = os.write(self._fd, data)
                if n <= 0:
                    # spurious — surrender briefly and retry
                    time.sleep(0.01)
                    continue
                data = data[n:]
            except BlockingIOError:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise PtySessionError(
                        f"pty write stuck after {timeout_s}s "
                        f"({len(data)} bytes pending)"
                    )
                _, writable, _ = select.select(
                    [], [self._fd], [], min(0.5, remaining),
                )
                if not writable:
                    # nothing yet — re-loop and check the deadline
                    continue

    def _write_input(self, body: bytes) -> None:
        """Write prompt bytes to the pty.

        Strategies, in priority order:

        1. ``use_bracketed_paste`` + ``input_chunk_size > 0``: wrap body
           in ESC[200~ … ESC[201~ AND slow-feed the body in chunks.
           This is the right mode for claude 2026+ on prompts above ~5KB:
           bracketed-paste markers tell the TUI "this is one logical
           paste regardless of \\n", AND the chunked timing keeps the
           TUI from collapsing it as "[Pasted text +N lines, paste again
           to expand]" — that staged state would block submission via \\r.
        2. ``use_bracketed_paste`` (no chunking): wrap and write at once.
           Works for prompts under ~5KB.
        3. ``input_chunk_size > 0`` (no bracketed paste): slow-feed only.
           Use for engines that don't support bracketed paste.
        4. Default: one-shot write.
        """
        cfg = self._cfg
        chunk = cfg.input_chunk_size
        delay_s = max(0.0, cfg.input_chunk_delay_ms / 1000.0)

        def write_chunked(data: bytes) -> None:
            if chunk <= 0 or len(data) <= chunk:
                self._write_all(data)
                return
            for offset in range(0, len(data), chunk):
                self._write_all(data[offset:offset + chunk])
                if delay_s > 0 and offset + chunk < len(data):
                    time.sleep(delay_s)

        if cfg.use_bracketed_paste:
            self._write_all(b"\x1b[200~")
            write_chunked(body)
            self._write_all(b"\x1b[201~")
            return
        write_chunked(body)

    def ask(self, prompt: str, timeout: float = 60.0) -> str:
        if self._closed:
            raise PtySessionError("session is closed")
        cfg = self._cfg
        with self._lock:
            pre_len = len(self._buffer)
            body = sanitize_prompt(prompt)
            self._write_input(body)
            if cfg.use_bracketed_paste:
                # Let the TUI finish rendering "[Pasted text +N lines]"
                # before we send Enter — keystrokes that arrive mid-render
                # get dropped and the message stays parked on the staged
                # paste. Idle threshold (200ms) tracks Ink reconcile +
                # display flush; cap (2000ms) keeps us bounded if the
                # TUI keeps redrawing (e.g. spinner chrome).
                self._drain_until_idle(idle_ms=200, max_ms=2000)
            self._write_all(b"\r")

            # `response_marker` MUST appear before we declare done: claude
            # in tool-use loops pauses for several seconds between Read
            # results and the next action, and the bare `idle_ms > 4s`
            # rule used to fire mid-loop with no ⏺ marker emitted yet —
            # extract_response then fell back to dedup-non-chrome-lines
            # and returned a chrome scrap (e.g. `⎿ src/foo.ts ✳ Wibbling…`).
            # If the marker hasn't shown up yet, hold the idle bar much
            # higher (4× response_idle_ms) so we only bail when claude
            # has visibly stopped working.
            #
            # ALSO: with large prompts claude streams its response in
            # bursts and can pause 8+ seconds between segments — long
            # enough to trip the bare idle check while mid-emit of a
            # JSON block. We detect "obviously mid-stream" via unmatched
            # braces/brackets in the post-marker tail and hold the idle
            # bar at 3× until the JSON looks balanced. Once closing
            # markers appear (or there were no opening ones to begin
            # with), normal idle settles us promptly.
            no_marker_idle_ms = self._response_idle_ms * 4
            mid_stream_idle_ms = self._response_idle_ms * 3

            def _looks_incomplete(tail: str) -> bool:
                # Cheap structural check: count unmatched braces/brackets
                # in the tail. Strings can throw this off, but for the
                # review/swarm JSON-block use case the dominant pattern is
                # `{"findings":[...]}` so this is good enough.
                opens = tail.count("{") + tail.count("[")
                closes = tail.count("}") + tail.count("]")
                if opens > closes:
                    return True
                # Mid-paragraph cliffhanger: ends with ":" or "," — claude
                # is about to emit more.
                stripped_tail = tail.rstrip()
                if stripped_tail.endswith((":", ",", "{", "[", "(")):
                    return True
                return False

            def done(s: _PumpState) -> bool:
                if s.bytes_seen <= 0:
                    return False
                if cfg.response_marker:
                    stripped = strip_ansi_bytes(bytes(self._buffer[pre_len:]))
                    marker_idx = stripped.rfind(cfg.response_marker)
                    if marker_idx >= 0:
                        # Extract just the tail past the last marker for the
                        # completeness check — earlier markers are intros
                        # whose closing braces don't affect the final JSON.
                        tail = stripped[marker_idx + len(cfg.response_marker):]
                        # Drop trailing TUI status (input bar / spinner) so it
                        # doesn't confuse the open/close count.
                        # Cut at first occurrence of typical post-response
                        # chrome anchors.
                        for anchor in ("\n❯", "Cooked for", "Churned for"):
                            cut = tail.find(anchor)
                            if cut > 0:
                                tail = tail[:cut]
                                break
                        if _looks_incomplete(tail):
                            return s.idle_ms > mid_stream_idle_ms
                        return s.idle_ms > self._response_idle_ms
                    return s.idle_ms > no_marker_idle_ms
                return s.idle_ms > self._response_idle_ms

            self._pump_until(done, timeout_s=timeout, error_label="ask")
            post_bytes = bytes(self._buffer[pre_len:])
            stripped = strip_ansi_bytes(post_bytes)
            result = extract_response(stripped, cfg)
            # When extraction returns empty but bytes were actually received,
            # surface a buffer dump to stderr so callers can see what claude
            # really emitted. Common causes: (a) chrome_regex cut at offset 0
            # because the response opens with a spinner label; (b) claude
            # printed a refusal / clarification request instead of JSON;
            # (c) the response_marker '⏺' never appeared.
            if not result and len(post_bytes) > 0:
                pre_bytes = bytes(self._buffer[:pre_len])
                pre_stripped = strip_ansi_bytes(pre_bytes)
                marker_positions: list[int] = []
                if cfg.response_marker:
                    start = 0
                    while True:
                        i = stripped.find(cfg.response_marker, start)
                        if i < 0:
                            break
                        marker_positions.append(i)
                        start = i + 1
                sys.stderr.write(
                    f"[kern-engines-daemon] ask() extracted empty "
                    f"from {len(post_bytes)}B raw / {len(stripped)} chars stripped; "
                    f"marker={cfg.response_marker!r} count={len(marker_positions)}\n"
                )
                sys.stderr.write(
                    f"[kern-engines-daemon] pre-send (startup) tail (last 300c): "
                    f"{pre_stripped[-300:]!r}\n"
                )
                # Dump a window around each marker position so we can see
                # what extract_response is choosing among.
                for i, pos in enumerate(marker_positions[-3:]):  # last 3 markers
                    snippet = stripped[max(0, pos - 60):pos + 300]
                    sys.stderr.write(
                        f"[kern-engines-daemon] marker@{pos}: {snippet!r}\n"
                    )
                sys.stderr.write(
                    f"[kern-engines-daemon] post-send tail (last 500c): "
                    f"{stripped[-500:]!r}\n"
                )
                sys.stderr.flush()
            return result

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
            body = sanitize_prompt(prompt)
            self._write_input(body)
            if cfg.use_bracketed_paste:
                # Let the TUI finish rendering "[Pasted text +N lines]"
                # before we send Enter — keystrokes that arrive mid-render
                # get dropped and the message stays parked on the staged
                # paste. Idle threshold (200ms) tracks Ink reconcile +
                # display flush; cap (2000ms) keeps us bounded if the
                # TUI keeps redrawing (e.g. spinner chrome).
                self._drain_until_idle(idle_ms=200, max_ms=2000)
            self._write_all(b"\r")

            last_emitted = ""
            last_emit_at = time.monotonic()
            response_marker = cfg.response_marker
            response_seen = False

            def done(s: _PumpState) -> bool:
                nonlocal last_emitted, last_emit_at, response_seen
                now = time.monotonic()
                # Only consider a snapshot every stream_emit_interval_s and
                # only after we've seen *any* bytes back from the engine.
                if now - last_emit_at >= cfg.stream_emit_interval_s and s.bytes_seen > 0:
                    snapshot = extract_response(
                        strip_ansi_bytes(bytes(self._buffer[pre_len:])), cfg,
                    )
                    # Before the response marker appears we're scraping the
                    # spinner/animation area — emitting that as "progress"
                    # is just noise. Hold off until the marker shows up.
                    if response_marker and response_marker not in strip_ansi_bytes(
                        bytes(self._buffer[pre_len:])
                    ) and not response_seen:
                        return s.idle_ms > self._response_idle_ms
                    response_seen = True
                    if snapshot and snapshot != last_emitted:
                        # Only emit if the response strictly grew. Regressions
                        # (e.g. chrome line briefly extending the extract,
                        # then disappearing again) update the watermark
                        # silently — they don't get yielded as a chunk.
                        if snapshot.startswith(last_emitted) and len(snapshot) > len(last_emitted):
                            delta = snapshot[len(last_emitted):]
                            # Suppress whitespace-only deltas from redraws.
                            if delta.strip():
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
