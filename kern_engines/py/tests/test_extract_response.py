"""Regression cover for the Claude pty response scraper.

These pin `extract_response` / `_dedupe_filter` / `_crop_to_transcript` against
the EXACT failure modes observed live on 2026-05-29 (claude TUI v2.1.156):

  - the user's personal animated statusLine (a context-gauge "[#####.] 96%" +
    plugin shield/orb glyphs) bleeding into the scrape, and
  - claude painting its live spinner to the RIGHT of the reply on the same
    screen row ("⏺ PONG  ✽ Channelling… (1s · …)"), which the ANSI strip merges
    onto the answer's line so the line-based chrome filter used to drop the
    answer with it.

The fixtures are post-ANSI-strip transcripts (what `strip_ansi_bytes` yields),
built from real captures with machine paths/branch genericised. They run with
NO live claude, so a future TUI change shows up as a FAILING TEST here rather
than a silent empty/garbage dispatch in prod.

Run: ``python3 -m pytest kern_engines/tests -q`` from the repo root.
"""

from __future__ import annotations

import re

from kern_engines.cli.configs import CLAUDE
from kern_engines.cli.pty_session import (
    _crop_to_transcript,
    _dedupe_filter,
    extract_response,
)

_DIV = "─" * 160  # claude's full-width transcript/input divider


def _xr(transcript: str) -> str:
    return extract_response(transcript, CLAUDE)


# ── the headline bug: spinner + statusline merged past the reply ────────────


def test_pong_recovered_despite_spinner_merged_on_same_row():
    # The exact shape that returned chrome instead of PONG: the spinner sits
    # to the right of "⏺ PONG" on the same row, then a divider, then bottom
    # chrome (status line + input bar).
    transcript = (
        "⏺ PONG  ✽ Channelling… (1s · ↓ 1 tokens)    ❯   \n"
        f"{_DIV}\n"
        " esc to interrupt ● high · /effort\n"
        "     ✻ Worked for 1s  ❯   ? for shortcuts · ← for agents\n"
    )
    assert _xr(transcript) == "PONG"


def test_personal_statusline_never_leaks_into_answer():
    # The original report: an animated context-gauge + plugin glyphs from the
    # user's ~/.claude statusLine. It is rendered at the very bottom, past the
    # divider — crop must drop it entirely.
    transcript = (
        "⏺ The answer is 42.  ✶ Pollinating… (2s · ↑ 3 tokens)  ❯\n"
        f"{_DIV}\n"
        "  ✻ Crunched for 2s  ❯  ? for shortcuts · ← for agents\n"
        "| 🔮 [█████████░] 96% | 🛡️ 📖3 ✏️1 ✅\n"
    )
    out = _xr(transcript)
    assert out == "The answer is 42."
    for leaked in ("🔮", "🛡️", "96%", "Pollinating", "Crunched for", "❯", "█"):
        assert leaked not in out, f"chrome leaked: {leaked!r} in {out!r}"


def test_multiline_answer_preserved_no_chrome():
    transcript = (
        "⏺ Red\n"
        "Yellow\n"
        "Blue  ✽ Forging… (1s · ↓ 5 tokens)  ❯\n"
        f"{_DIV}\n"
        "  ✻ Worked for 1s  ❯  ? for shortcuts\n"
        "| 🔮 [████░░░░░░] 41% ⚡\n"
    )
    out = _xr(transcript)
    assert "Red" in out and "Yellow" in out and "Blue" in out
    assert "🔮" not in out and "Worked for" not in out and "Forging" not in out


def test_json_block_survives_clean():
    transcript = (
        '⏺ {"status":"ok","n":3}  ✶ Distilling… (1s)  ❯\n'
        f"{_DIV}\n"
        "  ✻ Worked for 1s  ❯  ? for shortcuts · ← for agents\n"
    )
    assert _xr(transcript) == '{"status":"ok","n":3}'


# ── unit-level pins for the individual mechanisms ───────────────────────────


def test_crop_to_transcript_cuts_at_first_divider():
    assert _crop_to_transcript(f"answer here\n{_DIV}\nbottom chrome") == "answer here\n"
    # No divider → unchanged.
    assert _crop_to_transcript("just an answer") == "just an answer"


def test_dedupe_filter_cuts_line_at_spinner_glyph_and_prompt_arrow():
    chrome = re.compile(CLAUDE.chrome_regex)
    # spinner glyph mid-line → keep the prefix
    assert _dedupe_filter("PONG  ✽ Channelling…", chrome) == "PONG"
    # input-bar arrow mid-line → keep the prefix
    assert _dedupe_filter("Yellow ❯ ? for shortcuts", chrome) == "Yellow"
    # pure-chrome line → dropped to empty
    assert _dedupe_filter("✻ Worked for 1s ❯", chrome) == ""


def test_chrome_regex_matches_drifting_status_family():
    chrome = re.compile(CLAUDE.chrome_regex)
    # The generic "<verb> for <n>s" pattern must catch the whole family, incl.
    # verbs that did NOT exist in the hand-maintained list (the drift that
    # caused the original miss).
    for line in ("Worked for 1s", "Crunched for 2s", "Baked for 0s",
                 "Channelled for 12s", "Frobnicated for 7s"):
        assert chrome.search(line), f"chrome_regex missed drift: {line!r}"


def test_chrome_regex_does_not_eat_real_prose():
    # Guard against the generic status pattern over-matching legitimate text.
    chrome = re.compile(CLAUDE.chrome_regex)
    assert not chrome.search("I worked for three hours on this")
    assert not chrome.search("The function returns a value")
