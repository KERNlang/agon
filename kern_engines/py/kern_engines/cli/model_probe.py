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


def _read_until_picker_parsed(fd: int, binary: str, idle_ms: int, cap_ms: int,
                              grace_ms: int = 400) -> bytes:
    """Accumulate pty output until the engine's /model picker actually parses
    into >=1 model (then a short grace so the full list finishes painting), or
    ``cap_ms`` total elapses — whichever comes first.

    Unlike ``_read_until_idle`` this never bails on the quiet gap between the
    slash-command autocomplete closing and the picker rendering. That gap is
    what made claude's probe intermittently return zero models (the read
    returned mid-transition, before the picker painted) → the picker fell back
    to a stale static list. We re-parse the growing buffer each tick and only
    stop once a model row is recognised. ``idle_ms`` is unused for the
    not-yet-parsed case (we wait out ``cap_ms``); kept for signature parity.
    """
    buf = bytearray()
    start = time.monotonic()
    parsed_at: float | None = None
    while True:
        now = time.monotonic()
        if (now - start) * 1000 >= cap_ms:
            break
        if parsed_at is not None and (now - parsed_at) * 1000 >= grace_ms:
            break
        rdy, _, _ = select.select([fd], [], [], 0.05)
        if rdy:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break
            if chunk:
                buf.extend(chunk)
        if parsed_at is None and buf:
            try:
                if parse_picker(binary, strip_ansi_bytes(bytes(buf)))["models"]:
                    parsed_at = time.monotonic()
            except Exception:
                pass
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


# codex /model ("Select Model and Effort") collapses to ONE line (cursor-
# positioned TUI, no surviving newlines), so parse by the "N. <id>" pattern
# between the header and the confirm/footer text. ids are clean version tokens
# (gpt-5.x) used verbatim as id AND name; the active row carries "(current)".
_CODEX_ENTRY_RE = re.compile(r"\b\d+\.\s+([A-Za-z][\w.\-]*)(\s*\(current\))?")


def parse_codex_picker(stripped: str) -> dict:
    """Parse codex's /model picker (single-line, gpt-5.x ids)."""
    text = re.sub(r"\s+", " ", stripped)
    head = re.search(r"Select Model", text)
    if head:
        text = text[head.end():]
    foot = re.search(r"(Press enter|enter to confirm|esc to)", text, re.IGNORECASE)
    if foot:
        text = text[:foot.start()]
    models: list[dict] = []
    seen: set[str] = set()
    current_name: str | None = None
    for m in _CODEX_ENTRY_RE.finditer(text):
        mid = m.group(1)
        if not re.search(r"\d", mid):  # real model ids carry a version digit
            continue
        if mid in seen:
            continue
        seen.add(mid)
        cur = bool(m.group(2))
        if cur:
            current_name = mid
        models.append({"id": mid, "name": mid, "current": cur})
    return {"models": models, "current": current_name}


# claude /model: numbered "Select model" selector, also single-line. Each row is
# "N. <label> [✔] <Brand> <ver> [with 1M context] · <desc> · …". The label
# (Default/Sonnet/Haiku) is claude-UI; the real model is the Brand+ver after it.
# `✔` marks the active model. Typing /model first shows claude's slash-command
# AUTOCOMPLETE menu, so anchor on the LAST "Select model". --model takes brand
# aliases (opus/sonnet/haiku) + a [1m] suffix for the distinct 1M-context Sonnet.
_CLAUDE_BRAND_RE = re.compile(r"\b(Opus|Sonnet|Haiku)\s+(\d+(?:\.\d+)?)")


def parse_claude_picker(stripped: str) -> dict:
    """Parse claude's /model selector into {id(alias),name,current} rows."""
    text = re.sub(r"\s+", " ", stripped)
    head = text.rfind("Select model")
    if head >= 0:
        text = text[head:]
    foot = re.search(r"(● High effort|Use /fast|Enter to confirm)", text)
    if foot:
        text = text[:foot.start()]
    models: list[dict] = []
    seen: set[str] = set()
    current_name: str | None = None
    for part in re.split(r"(?=\b\d+\.\s)", text):
        em = re.match(r"\s*\d+\.\s+(.*)", part)
        if not em:
            continue
        body = em.group(1)
        bm = _CLAUDE_BRAND_RE.search(body)  # skips "Sonnet (1M context)" (no digit) → "Sonnet 4.6"
        if not bm:
            continue
        brand, ver = bm.group(1), bm.group(2)
        is_current = "✔" in body
        is_1m = bool(re.search(r"1M", body))
        sonnet_1m = is_1m and brand.lower() == "sonnet"
        name = f"{brand} {ver}" + (" (1M context)" if sonnet_1m else "")
        mid = brand.lower() + ("[1m]" if sonnet_1m else "")
        if mid in seen:
            continue
        seen.add(mid)
        if is_current:
            current_name = name
        models.append({"id": mid, "name": name, "current": is_current})
    return {"models": models, "current": current_name}


# Per-engine parser registry (keyed by binary basename). New engines slot in
# here with their own parser; default is the agy "Switch Model" style.
PARSERS = {
    "agy": parse_model_picker,
    "antigravity": parse_model_picker,
    "codex": parse_codex_picker,
    "claude": parse_claude_picker,
}


def parse_picker(binary: str, stripped: str) -> dict:
    """Dispatch to the right per-engine parser by binary basename."""
    key = os.path.basename(binary)
    return PARSERS.get(key, parse_model_picker)(stripped)


def probe_models(binary: str, slash_command: str = "/model",
                 boot_idle_ms: int = 2200, boot_cap_ms: int = 15000,
                 picker_idle_ms: int = 1200, picker_cap_ms: int = 12000) -> dict:
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
        # Let the slash-command autocomplete settle before Enter — claude opens
        # a command-autocomplete dropdown on "/model" and a too-eager Enter
        # lands before it resolves, so the picker never opens.
        time.sleep(0.8)
        os.write(fd, b"\r")
        # Read until the picker actually parses, not the first quiet gap (see
        # _read_until_picker_parsed) — the gap is what dropped claude's models.
        picker = _read_until_picker_parsed(fd, binary, picker_idle_ms, picker_cap_ms)
        parsed = parse_picker(binary, strip_ansi_bytes(picker))
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
