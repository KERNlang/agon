"""Per-engine ``EngineConfig`` instances.

Add a new engine by:
1. defining its ``EngineConfig`` here,
2. adding it to ``REGISTRY``,
3. (TS side) adding a one-liner wrapper that calls ``spawnSession("<id>")``.

That's it. No new pty plumbing, no new daemon glue.
"""

from __future__ import annotations

from .pty_session import EngineConfig


# Tools agon delegates to claude without per-call confirmation. Claude
# is running inside agon's harness — patrol rules, hooks, and the agon
# confirmation surface already gate dangerous actions at the outer
# layer. A second prompt from claude would (a) be redundant policy,
# (b) hang our pty scraper because we can't answer an interactive y/n.
#
# Using --allowedTools (claude-native, granular whitelist) instead of
# --dangerously-skip-permissions because the latter triggers a one-time
# "Bypass Permissions mode" confirmation banner that traps the pty boot
# heuristic. --allowedTools auto-approves listed tools without any banner.
#
# AskUserQuestion is deliberately NOT on the list: if claude tried to use
# it our scraper would hang waiting for a human answer. If claude does
# try it, the dispatch times out (loud failure) rather than wedging.
_CLAUDE_ALLOWED_TOOLS = (
    "Bash Edit Read Write MultiEdit Glob Grep "
    "TodoWrite WebFetch WebSearch Task NotebookEdit"
)


CLAUDE = EngineConfig(
    id="claude",
    binary="claude",
    # Claude's interactive prompt indicator. Sent inside the input bar.
    prompt_marker_bytes="❯".encode("utf-8"),
    # Claude prefixes each assistant response with this glyph in the
    # transcript area.
    response_marker="⏺",
    # Filter Claude 2026+ TUI noise. chrome_regex cuts the response tail at
    # the FIRST match, so patterns must reliably appear AFTER the assistant
    # message. Spinner labels end with "…" (Unicode ellipsis) — anchor on it
    # so we never match a verb inside claude's own prose. NOTE: do NOT include
    # "Confidence:" here — claude prefixes its final answer with a
    # "Confidence: ~0.82" line as part of the response, so cutting on it
    # deletes the entire reply (this was an agon-side capture bug).
    chrome_regex=(
        r"(?:Cogitating…|Pondering…|Philosophising…|Fiddle-faddling…|"
        r"Caramelizing…|Crunching…|Chewing…|Marinating…|Steeping…|"
        r"Simmering…|Unravelling…|Pontificating…|Ruminating…|"
        r"Deliberating…|Contemplating…|Synthesising…|Synthesizing…|"
        r"Forming…|Prestidigitating…|Conjuring…|Distilling…|Whisking…|"
        r"Wibbling…|Wobbling…|Buzzing…|Crystallising…|Crystallizing…|"
        r"Mulling…|Percolating…|Fermenting…|Transmuting…|"
        r"Brewed for|Sautéed|Cooked|Churned|Reasoning…|"
        r"Churned for|Cooked for|"
        r"running stop hooks|Accomplishing|"
        r"thought for [0-9]+s|"
        # Generic completion-status line "<verb> for <n>s" (Worked/Crunched/
        # Baked/Cooked/Channelled/…). Catches the whole drifting family at once
        # so a NEW spinner verb can't leak the way "Pollinating…"/"Crunched for"
        # did — the blacklist no longer has to enumerate every verb claude ships.
        r"\b\w+ for [0-9]+s\b|"
        r"esc to interrupt|\? for shortcuts|← for agents|"
        r"automode|⏵⏵|ctx:|/effort|tokens?\)|"
        r"\([0-9]+s\s*[·•])"
    ),
    env_strip=(
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_TOOL_RESULT_FD",
    ),
    # `--setting-sources project,local`: load ONLY workspace settings, NOT the
    # user's personal `~/.claude/settings.json`. That personal layer is where a
    # custom statusLine lives (e.g. an animated context-gauge + plugin glyphs);
    # under a pty it (a) renders glyphs no chrome filter matches and (b) ANIMATES
    # continuously, defeating idle-based done-detection — so the scraper returns
    # the statusline/spinner instead of the answer (the chrome-bleed bug). OAuth
    # subscription auth lives in the macOS KEYCHAIN, NOT in a setting source, so
    # dropping `user` keeps us authenticated (verified: a clean dir hits the
    # login picker, but `--setting-sources project,local` does not). This is the
    # workspace-pure principle (strip personal tooling, keep workspace config)
    # applied to the pty path. NB: `--bare` is NOT usable here — it forces
    # strictly ANTHROPIC_API_KEY and bypasses the subscription (would bill
    # credits / hit the login screen).
    # Exec mode: same whitelist. Tool calls during chat (git status,
    # grep, etc.) auto-approve without pausing the scraper.
    extra_argv=(
        "--allowedTools", _CLAUDE_ALLOWED_TOOLS,
        "--setting-sources", "project,local",
    ),
    # Agent mode: same whitelist. Edits and shell commands auto-approve.
    # No --dangerously-skip-permissions because it shows a startup banner
    # that breaks pty boot detection.
    agent_extra_argv=(
        "--allowedTools", _CLAUDE_ALLOWED_TOOLS,
        "--setting-sources", "project,local",
    ),
    # Claude 2026+ TUI collapses a large burst write into
    # "[Pasted text +N lines, paste again to expand]" and a single Enter no
    # longer submits — the session parks on the staged paste and we scrape the
    # placeholder instead of a reply (the paste-placeholder bug). Bracketed
    # paste tells the TUI "one logical paste regardless of embedded \n", and
    # the chunked slow-feed (512B / 4ms) keeps it from tripping burst
    # detection. Together they make multi-line review prompts submit cleanly.
    use_bracketed_paste=True,
    input_chunk_size=512,
    input_chunk_delay_ms=4,
    # Wide cols so the TUI doesn't wrap long single-line JSON findings across
    # rows — TUI wrap uses cursor-position ANSI (not \n), and our ANSI strip
    # would collapse the wrapped words together ("No check for b===0" →
    # "Nocheckforb===0"). 500 cols fits any reasonable finding on one row.
    cols=500,
)


# ─────────────────────────────────────────────────────────────────────────
# UNWIRED STUBS — kept here as templates, not exposed via REGISTRY yet.
#
# Each shows the minimal config needed to onboard another engine when its
# billing forces us off `--print`. To activate one:
#   1. Verify the marker bytes / chrome regex against a real session
#      (run `claude-tui-probe.py` clone for that binary).
#   2. Add it to REGISTRY below.
#   3. Add a TS shim like `cli/codex.ts` that calls
#      `PtyCliSession.spawn('codex', ...)`.
#   4. Update adapter-helpers to recognise it in shouldUsePty.
# ─────────────────────────────────────────────────────────────────────────

CODEX_STUB = EngineConfig(
    id="codex",
    binary="codex",
    # UNVERIFIED — Codex TUI markers need a live probe to confirm.
    prompt_marker_bytes="▶".encode("utf-8"),
    response_marker="◆",
    chrome_regex=r"(?:status|tokens?\)|elapsed_steps)",
    env_strip=("CODEX_SESSION_ID",),
    agent_extra_argv=(
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
    ),
)


REGISTRY: dict[str, EngineConfig] = {
    CLAUDE.id: CLAUDE,
    # CODEX_STUB intentionally not added until its markers are verified
    # against a real Codex TUI capture. Treat it as the on-ramp template.
}


def get(engine_id: str) -> EngineConfig:
    try:
        return REGISTRY[engine_id]
    except KeyError as e:
        raise KeyError(
            f"no pty config for engine {engine_id!r}; "
            f"known: {sorted(REGISTRY)}"
        ) from e
