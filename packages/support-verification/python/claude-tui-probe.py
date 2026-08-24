#!/usr/bin/env python3
"""Phase 0 probe — pty-driven Claude TUI smoke test.

Pyte-free hot path. The original version used pyte for live screen tracking;
it hung on certain byte sequences emitted by Claude's TUI. This version only
collects raw bytes and uses regex/ANSI-strip at the end. Pyte still powers
the long-lived `ClaudeCliSession` in kern_engines/cli/claude.py; this probe
deliberately bypasses it to validate the substrate (pty + subscription
billing path) without depending on pyte's parser stability.

Run:
    python3 scripts/claude-tui-probe.py "reply with exactly: pong"

Acceptance:
- spawns Claude under a pty
- writes a prompt
- captures the response after Claude settles
- exits 0
- no zombie processes, no SDK credits

DO NOT run inside an existing Claude Code session. Run from a plain shell.
"""

from __future__ import annotations

import argparse
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
import time
from dataclasses import dataclass
from typing import Optional

# SIGUSR1 → dump every thread's stack to stderr. Useful when hunting hangs.
faulthandler.enable()
try:
    faulthandler.register(signal.SIGUSR1, all_threads=True, chain=False)
except (AttributeError, ValueError):  # pragma: no cover
    pass

# ── byte sanitiser ────────────────────────────────────────────────────────

_DROP = bytes(
    [b for b in range(0x00, 0x20) if b not in (0x09, 0x0a)]
) + bytes([0x7f])
_DROP_TABLE = bytes.maketrans(_DROP, b"\x20" * len(_DROP))


def sanitize_prompt(prompt: str) -> bytes:
    return prompt.encode("utf-8", errors="replace").translate(_DROP_TABLE)


# ── helpers ───────────────────────────────────────────────────────────────


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def _is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def _terminate(pid: int, grace_s: float) -> int:
    if not _is_alive(pid):
        try:
            _, status = os.waitpid(pid, os.WNOHANG)
            return status
        except ChildProcessError:
            return 0
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    deadline = time.monotonic() + grace_s
    while time.monotonic() < deadline:
        try:
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid != 0:
                return status
        except ChildProcessError:
            return 0
        time.sleep(0.05)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    # Bounded reap. If something else owns this pty's read side (e.g.,
    # claude spawned a helper that's keeping the pty alive), blocking
    # waitpid would hang forever — we don't care.
    reap_deadline = time.monotonic() + 1.0
    while time.monotonic() < reap_deadline:
        try:
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid != 0:
                return status
        except ChildProcessError:
            return 0
        time.sleep(0.05)
    return 0


# Strip CSI, OSC, single-char escapes. Bracketed paste, mouse tracking,
# colour codes, cursor moves — all go away.
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


# ── probe config ──────────────────────────────────────────────────────────


@dataclass
class ProbeConfig:
    cols: int = 120
    rows: int = 40
    chunk_size: int = 16384
    poll_interval_s: float = 0.05
    boot_min_ms: int = 1500
    ready_marker_bytes: bytes = b"\xe2\x9d\xaf"  # ❯ U+276F utf-8
    ready_settle_idle_ms: int = 400
    response_idle_ms: int = 2000
    overall_timeout_s: float = 60.0
    sigterm_grace_s: float = 2.0


@dataclass
class ProbeResult:
    response: str
    raw_text: str
    duration_s: float
    state_history: list[str]
    total_bytes: int


# ── main probe ────────────────────────────────────────────────────────────


def run_probe(
    prompt: str,
    cfg: Optional[ProbeConfig] = None,
    *,
    tick_log: Optional[object] = None,
) -> ProbeResult:
    cfg = cfg or ProbeConfig()

    pid, fd = pty.fork()
    if pid == 0:
        # Child
        os.environ["TERM"] = "xterm-256color"
        os.environ.setdefault("LANG", "en_US.UTF-8")
        for var in (
            "CLAUDECODE",
            "CLAUDE_CODE_ENTRYPOINT",
            "CLAUDE_CODE_SESSION_ID",
            "CLAUDE_TOOL_RESULT_FD",
        ):
            os.environ.pop(var, None)
        try:
            os.execvp("claude", ["claude"])
        except FileNotFoundError:
            sys.stderr.write("claude binary not found on PATH\n")
            os._exit(127)
        os._exit(127)

    _set_winsize(fd, cfg.rows, cfg.cols)
    # non-blocking fd so a stuck child can't wedge os.read
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    sanitized = sanitize_prompt(prompt) + b"\r"

    buffer = bytearray()
    pre_send_len = 0
    start = time.monotonic()
    last_byte_at = start
    last_tick_log = start
    state = "boot"
    state_history: list[str] = [state]

    def _tick(now: float, idle_ms: float) -> None:
        if tick_log is None:
            return
        tail = bytes(buffer[-200:])
        text_tail = strip_ansi_bytes(tail)
        text_tail = re.sub(r"\s+", " ", text_tail).strip()[-100:]
        tick_log.write(
            f"[t={now-start:5.1f}s {state:5s}] bytes={len(buffer):6d} "
            f"idle={idle_ms:5.0f}ms tail={text_tail!r}\n"
        )
        tick_log.flush()

    try:
        while True:
            now = time.monotonic()
            elapsed = now - start
            if elapsed > cfg.overall_timeout_s:
                raise TimeoutError(
                    f"probe timeout {cfg.overall_timeout_s}s in state={state}"
                )

            # Block in select for the poll interval so the loop iteration
            # is bounded even if data flow is bursty. Don't add another
            # time.sleep after this — select already handled the wait.
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
                buffer.extend(chunk)
                last_byte_at = now

            idle_ms = (now - last_byte_at) * 1000.0

            if tick_log is not None and now - last_tick_log >= 1.0:
                _tick(now, idle_ms)
                last_tick_log = now

            if state == "boot":
                # Wait for the prompt-marker byte sequence to appear AND for
                # a short idle window — that means Claude has finished
                # drawing the initial frame.
                booted_ms = elapsed * 1000.0
                if (
                    booted_ms > cfg.boot_min_ms
                    and cfg.ready_marker_bytes in buffer
                    and idle_ms > cfg.ready_settle_idle_ms
                ):
                    state = "ready"
                    state_history.append(state)

            elif state == "ready":
                pre_send_len = len(buffer)
                os.write(fd, sanitized)
                state = "sent"
                state_history.append(state)

            elif state == "sent":
                # "done" = no new bytes for response_idle_ms AND we got
                # at least one byte back from Claude post-send.
                if (
                    len(buffer) > pre_send_len
                    and idle_ms > cfg.response_idle_ms
                ):
                    state = "done"
                    state_history.append(state)
                    break

            if not _is_alive(pid):
                state_history.append("child-exited")
                break

        raw_text = strip_ansi_bytes(bytes(buffer))
        post_text = strip_ansi_bytes(bytes(buffer[pre_send_len:]))
        response = _extract_response(post_text)
        return ProbeResult(
            response=response,
            raw_text=raw_text,
            duration_s=time.monotonic() - start,
            state_history=state_history,
            total_bytes=len(buffer),
        )
    finally:
        _terminate(pid, cfg.sigterm_grace_s)
        try:
            os.close(fd)
        except OSError:
            pass


_TUI_NOISE = re.compile(
    r"(\?\s*for shortcuts|Bypassing Permissions|Auto-Update available"
    r"|Welcome back|Try \".*?\"|■\s*\S+\s*■|✓ Ready|Press \w+ to)"
)


def _extract_response(post_text: str) -> str:
    """Best-effort distillation of Claude's reply from the rendered transcript.

    Claude's TUI prefixes assistant text with U+23FA (⏺). When that marker
    is present, take everything between it and the next chrome element.
    Otherwise fall back to a noisy line-dedupe (better than nothing).
    """
    text = re.sub(r"\r\n", "\n", post_text)
    text = re.sub(r"\r", "\n", text)

    response_marker = "⏺"
    if response_marker in text:
        idx = text.index(response_marker)
        tail = text[idx + len(response_marker):]
        # Cut at the first chrome line (status/confidence/etc.)
        stop = re.search(
            r"(Confidence:|Accomplishing|Sautéed|Cooked|Churned|"
            r"automode|⏵⏵|ctx:|/effort|tokens?\))",
            tail,
        )
        if stop:
            tail = tail[: stop.start()]
        # Collapse whitespace runs but preserve newlines.
        tail = re.sub(r"[ \t]+", " ", tail)
        tail = re.sub(r"\n{2,}", "\n", tail)
        return tail.strip()

    lines = text.split("\n")
    kept: list[str] = []
    seen: set[str] = set()
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if re.fullmatch(r"[─-▟\s]+", line):
            continue
        if _TUI_NOISE.search(line):
            continue
        if line.startswith("> ") or line.startswith("❯ "):
            continue
        key = line[:120]
        if key in seen:
            continue
        seen.add(key)
        kept.append(line)
    return "\n".join(kept).strip()


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Phase 0 claude TUI pty probe (pyte-free)")
    p.add_argument("prompt", nargs="*", default=["reply with exactly: pong"])
    p.add_argument("--cols", type=int, default=120)
    p.add_argument("--rows", type=int, default=40)
    p.add_argument("--timeout", type=float, default=60.0)
    p.add_argument("--debug", action="store_true")
    p.add_argument(
        "--dump-raw",
        action="store_true",
        help="also print the full ANSI-stripped buffer to stderr",
    )
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    prompt = " ".join(args.prompt).strip()
    cfg = ProbeConfig(
        cols=args.cols, rows=args.rows, overall_timeout_s=args.timeout,
    )
    tick_log = sys.stderr if args.debug else None
    try:
        result = run_probe(prompt, cfg, tick_log=tick_log)
    except TimeoutError as e:
        sys.stderr.write(f"timeout: {e}\n")
        return 124

    print(result.response or "<no response captured>")
    if args.debug:
        sys.stderr.write(
            f"\n--- state ---\n{' -> '.join(result.state_history)}\n"
            f"--- duration ---\n{result.duration_s:.2f}s\n"
            f"--- bytes ---\n{result.total_bytes}\n"
        )
        if args.dump_raw:
            sys.stderr.write(f"--- raw ---\n{result.raw_text}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
