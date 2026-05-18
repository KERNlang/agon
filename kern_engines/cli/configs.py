"""Per-engine ``EngineConfig`` instances.

Add a new engine by:
1. defining its ``EngineConfig`` here,
2. adding it to ``REGISTRY``,
3. (TS side) adding a one-liner wrapper that calls ``spawnSession("<id>")``.

That's it. No new pty plumbing, no new daemon glue.
"""

from __future__ import annotations

from .pty_session import EngineConfig


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
    # Agent mode: tools enabled, all permission checks bypassed including
    # the workspace-trust dialog. Matches what claude.json's `agent.args`
    # used for the legacy --print path. The caller is opting in by routing
    # through agent dispatch — same trust contract as before.
    agent_extra_argv=(
        "--dangerously-skip-permissions",
    ),
)


# Add other engines here when their billing forces us to pty-drive them.
# Until then, structured stream-json is strictly better — see README.

REGISTRY: dict[str, EngineConfig] = {
    CLAUDE.id: CLAUDE,
}


def get(engine_id: str) -> EngineConfig:
    try:
        return REGISTRY[engine_id]
    except KeyError as e:
        raise KeyError(
            f"no pty config for engine {engine_id!r}; "
            f"known: {sorted(REGISTRY)}"
        ) from e
