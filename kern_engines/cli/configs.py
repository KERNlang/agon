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
    chrome_regex=(
        r"(?:Confidence:|Accomplishing|Sautéed|Cooked|Churned|Reasoning|"
        r"automode|⏵⏵|ctx:|/effort|tokens?\))"
    ),
    env_strip=(
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_TOOL_RESULT_FD",
    ),
    # Exec mode: same whitelist. Tool calls during chat (git status,
    # grep, etc.) auto-approve without pausing the scraper.
    extra_argv=(
        "--allowedTools", _CLAUDE_ALLOWED_TOOLS,
    ),
    # Agent mode: same whitelist. Edits and shell commands auto-approve.
    # No --dangerously-skip-permissions because it shows a startup banner
    # that breaks pty boot detection.
    agent_extra_argv=(
        "--allowedTools", _CLAUDE_ALLOWED_TOOLS,
    ),
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
