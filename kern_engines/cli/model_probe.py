"""Probe a CLI engine's live model list by driving its in-TUI picker.

Some CLIs (notably ``agy``/Antigravity, the Gemini CLI successor) expose no
``--list-models`` flag — the only authoritative source of the *current*
available models is the interactive ``/model`` picker. This module spawns the
binary under a pty, opens the picker, scrapes the rendered list, cancels
(ESC — never changes the selection), and returns the parsed models as JSON.

It reuses the robust raw-bytes + ANSI-strip machinery from ``pty_session`` (no
pyte — terminal emulators hang on some TUI byte sequences). Read-only: the only
keys sent are the slash command and ESC.

CLI:  python3 -m kern_engines.cli.model_probe <binary> [slash_command]
      → prints JSON {"models":[{"id","name","current"}],"current":"<name>"} on
        stdout, or {"error":"..."} (still exit 0 so the TS caller can fall back
        to the static list cleanly).
"""

from __future__ import annotations

import json
import os
import pty
import select
import signal
import sys
import time
import fcntl
import termios
import struct
import re

try:
    # Normal package import (python3 -m kern_engines.cli.model_probe).
    from .pty_session import strip_ansi_bytes
except ImportError:
    # Direct-script invocation (python3 /abs/path/.../cli/model_probe.py):
    # bootstrap the package root onto sys.path so the TS caller doesn't need
    # to set PYTHONPATH or know the module layout.
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    from kern_engines.cli.pty_session import strip_ansi_bytes


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def _read_until_idle(fd: int, idle_ms: int, cap_ms: int) -> bytes:
    """Accumulate pty output until it's been quiet for ``idle_ms`` (after the
    first byte) or ``cap_ms`` total elapses — whichever comes first."""
    buf = bytearray()
    start = time.monotonic()
    last = start
    while True:
        now = time.monotonic()
        if (now - start) * 1000 >= cap_ms:
            break
        if buf and (now - last) * 1000 >= idle_ms:
            break
        rdy, _, _ = select.select([fd], [], [], 0.05)
        if rdy:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break
            if chunk:
                buf.extend(chunk)
                last = now
    return bytes(buf)


def slugify_model_name(name: str) -> str:
    """Map an agy picker display name to its model id.

    "Gemini 3.5 Flash (High)" -> "gemini-3.5-flash-high"
    "GPT-OSS 120B (Medium)"   -> "gpt-oss-120b-medium"
    "Claude Sonnet 4.6 (Thinking)" -> "claude-sonnet-4-6-thinking"

    Matches the ids hand-probed into engines/agy.json so dynamic and static
    lists line up.
    """
    s = name.strip().lower()
    s = s.replace("(", " ").replace(")", " ")
    s = s.replace(".", ".")  # keep dots (3.5, 4.6)
    s = re.sub(r"[^a-z0-9.]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s


# Picker structural anchors. The list lives between a "Switch Model" header and
# a "Keyboard:" footer; each row is "<name>", the active one carries a leading
# "> " caret and a trailing "(current)".
_HEADER = "Switch Model"
_FOOTER_RE = re.compile(r"^(Keyboard:|esc |\?\s*for shortcuts|↑/↓)")
_NAV_NOISE_RE = re.compile(r"(Navigate|Select|Go Back|Complete|to cancel|Set a model)")
_CURRENT_RE = re.compile(r"\(current\)\s*$", re.IGNORECASE)


def parse_model_picker(stripped: str) -> dict:
    """Parse the ANSI-stripped /model picker screen into model rows.

    Returns {"models":[{"id","name","current"}], "current": "<name>|None"}.
    Pure — unit-tested against a captured real agy 1.0.2 screen.
    """
    text = re.sub(r"\r\n?", "\n", stripped)
    lines = text.split("\n")
    # Start after the LAST "Switch Model" header (the picker may redraw).
    start = -1
    for i, ln in enumerate(lines):
        if _HEADER in ln:
            start = i + 1
    if start < 0:
        return {"models": [], "current": None}

    models: list[dict] = []
    seen: set[str] = set()
    current_name: str | None = None
    for ln in lines[start:]:
        raw = ln.strip()
        if not raw:
            continue
        if _FOOTER_RE.search(raw):
            break
        # Strip the selection caret if present.
        is_caret = raw.startswith("> ") or raw.startswith(">")
        row = raw[1:].strip() if raw.startswith(">") else raw
        row = re.sub(r"\s{2,}", " ", row)
        is_current = bool(_CURRENT_RE.search(row))
        row = _CURRENT_RE.sub("", row).strip()
        if not row or _NAV_NOISE_RE.search(row):
            continue
        # A model row is "<Brand> <stuff> (Tier)" — require a parenthesised
        # tier so we never pick up stray chrome that slipped the footer check.
        if "(" not in raw and not re.search(r"\b(Flash|Pro|Sonnet|Opus|Haiku|Mini|Medium|High|Low|Thinking|[0-9]+B)\b", row):
            continue
        if row in seen:
            continue
        seen.add(row)
        cur = is_current or is_caret
        if cur:
            current_name = row
        models.append({"id": slugify_model_name(row), "name": row, "current": cur})
    return {"models": models, "current": current_name}


def probe_models(binary: str, slash_command: str = "/model",
                 boot_idle_ms: int = 1500, boot_cap_ms: int = 15000,
                 picker_idle_ms: int = 1200, picker_cap_ms: int = 9000) -> dict:
    """Spawn ``binary`` under a pty, open its model picker, scrape + parse it."""
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.environ.setdefault("LANG", "en_US.UTF-8")
        try:
            os.execvp(binary, [binary])
        except FileNotFoundError:
            os._exit(127)
        os._exit(127)

    try:
        _set_winsize(fd, 40, 200)
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        _read_until_idle(fd, boot_idle_ms, boot_cap_ms)  # let the TUI boot
        os.write(fd, slash_command.encode("utf-8"))
        time.sleep(0.4)
        os.write(fd, b"\r")
        picker = _read_until_idle(fd, picker_idle_ms, picker_cap_ms)
        parsed = parse_model_picker(strip_ansi_bytes(picker))
        # Cancel the picker without changing the selection, then quit.
        try:
            os.write(fd, b"\x1b")
            time.sleep(0.15)
            os.write(fd, b"\x1b")
        except OSError:
            pass
        return parsed
    finally:
        try:
            os.kill(pid, signal.SIGTERM)
            time.sleep(0.2)
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            os.close(fd)
        except OSError:
            pass


def main(argv: list[str]) -> int:
    if not argv:
        print(json.dumps({"error": "usage: model_probe <binary> [slash_command]"}))
        return 0
    binary = argv[0]
    slash = argv[1] if len(argv) > 1 else "/model"
    # Hard ceiling so a hung TUI can never wedge the caller.
    signal.alarm(35)
    try:
        result = probe_models(binary, slash)
    except BaseException as e:  # incl. SIGALRM
        print(json.dumps({"error": f"{type(e).__name__}: {e}"}))
        return 0
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
