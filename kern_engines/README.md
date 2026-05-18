# @agon/kern-engines

Engine substrates that drive third-party CLI/API agents on behalf of agon.

Lives in agon, **not** in KERN core. Tribunal verdict (codex + gemini + opencode + kimi + claude) locked this: engine orchestration is application policy, not language. Don't propose `engine` / `ask` primitives upstream.

This is a polyglot package — the **TypeScript twin** and the **Python twin** sit side-by-side in the same directory tree, each honouring the same public surface for a given engine. The shapes are **not** unified across CLI and API tiers: CLI returns text, API returns typed events. Pretending otherwise produces a lowest-common-denominator interface that every caller pierces. Don't try.

## Why this exists

Anthropic is removing free `claude -p` (non-interactive mode). Paid `-p` bills SDK credits ($20–$200/mo). We refuse to pay credits when the user is already paying for the Claude subscription. The interactive `claude` TUI runs against the subscription session — same as a human typing — so if we drive it via a pty, we keep the existing billing path.

AI-Buddies, agon, kern-sight, and codex-calling-claude flows all depend on this working.

## Layout

```
kern_engines/
├── __init__.py             # Python package marker
├── index.ts                # TS barrel (@agon/kern-engines)
├── cli/
│   ├── __init__.py
│   ├── claude.py           # ClaudeCliSession  (pty.fork + pyte)
│   └── claude.ts           # ClaudeCliSession  (node-pty + @xterm/headless)
├── examples/
│   └── use-claude-cli.kern # demo source (not auto-compiled)
├── pyproject.toml
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## Public surface

Same shape on both sides; do not unify across tiers.

### Python

```python
from kern_engines.cli.claude import ClaudeCliSession

with ClaudeCliSession() as cs:
    reply = cs.ask("hello, can you say 'pong'?")
    follow = cs.ask("now repeat that in french")
```

### TypeScript

```ts
import { ClaudeCliSession } from '@agon/kern-engines/cli/claude';

const cs = await ClaudeCliSession.spawn();
try {
  const reply = await cs.ask("hello, can you say 'pong'?");
  const follow = await cs.ask("now repeat that in french");
} finally {
  await cs.close();
}
```

## Install

### Python

```sh
python3 -m pip install --user pyte
```

A `pyproject.toml` is provided if you prefer a proper package install: `pip install -e kern_engines`.

### Node / TypeScript

`node-pty` and `@xterm/headless` are optional peer deps so missing them does not block the rest of agon from building. Install them to actually use the TS twin:

```sh
npm i node-pty @xterm/headless -w kern_engines
```

`node-pty` builds a native module — needs a working toolchain (Xcode CLT on macOS, build-essential on Linux). If the install fails, the TS twin throws `ClaudeSessionError("node-pty is not installed")` at spawn time and `adapter-cli` falls through to `spawnWithTimeout`.

## Wiring into adapter-cli

`packages/adapter-cli` adds an opt-in branch in `dispatch`: when `AGON_CLAUDE_PTY=1` and the engine is `claude`, dispatch routes through `ClaudeCliSession`. If the peer deps are missing it returns `unavailable:true` and the existing CLI/API/companion path takes over.

```sh
export AGON_CLAUDE_PTY=1
agon ...
```

The opt-in gate is intentional — Phase 0 validation has to be durable across our supported terminals before we make this the default.

`dispatchAgent` (forge / cesar autonomy) is *not* wired through the pty path because tool calls and permission prompts inside the TUI break the response-end heuristic. Agent mode still uses `claude` non-interactively. When the API removal lands, agent-mode flows that depend on it will need a different solution (a persistent ACP-style protocol or a TUI driver that understands the tool-call markers).

## Phase 0 probe

A standalone pty + pyte probe is at `scripts/claude-tui-probe.py`:

```sh
python3 -m pip install --user pyte
python3 scripts/claude-tui-probe.py "reply with exactly: pong"
```

Acceptance: prints Claude's response to stdout, exits 0, no zombies, no SDK credits consumed.

**Do not run inside an existing Claude Code session.** The child `claude` process will fight the parent for auth/sockets. Run from a plain shell.

## Hard constraints (honoured by both twins)

- **ANSI sanitisation on input.** ESC and other C0 control bytes (except TAB/LF) plus DEL are stripped from prompts before `os.write` / `pty.write`. Defensive against LLM-generated prompts that contain terminal escapes.
- **Response-end detection is layered.** Cursor-idle window + prompt-marker regex visible near the cursor + hard timeout. None alone is trusted. Cursor-idle alone is fooled by spinners. Marker alone is fooled by partial draws. Timeout alone wastes time.
- **Cleanup matters.** SIGTERM → grace deadline → SIGKILL → reap → close fd. Idempotent. `with`-statement and `__del__` (Python) / `try/finally` (TS) cover every exit path.
- **Throttle.** Multiple in-flight `ask()` calls on the same session are serialised by a Lock (Python) / busy flag (TS). The caller is responsible for not spawning many parallel sessions — Anthropic's ToS for subscription-tier automation is gray.

## ToS-risk findings

- Anthropic's subscription terms permit a real human delegating their session, but do not explicitly bless automated drivers. The pty path is a gray area. Treat it as such.
- Mitigations baked in: single-session-per-process default, hard timeouts, no parallel session spawn helper exposed, no "burst" mode.
- Do **not** publish abuse-friendly docs (high-throughput drivers, credential rotation guides, automated farm setups).
- Do **not** redistribute Claude responses as a service paid by third parties; that crosses from "delegation" into "redistribution".
- Anthropic may add detection for non-TTY drivers. The cleanest path forward is for them to ship a supported subscription-tier non-interactive endpoint; until then, the pty fallback is the honest workaround for the user-driven case.

## Known gaps

- `extern-pypi:` import scheme in KERN does not exist. The example at `examples/use-claude-cli.kern` uses the TS twin and adds a `KERN-GAP:` note describing the desired Python-bridge syntax. Track this in `KERN-GAPS.md`.
- Streaming `ask()` (yielding chunks as Claude generates) is not implemented. The current contract returns the full response text after settle. Streaming the screen scrape mid-response is doable (read each newly committed pyte row) but the chunking semantics need design.
- Tool-call / permission-prompt awareness inside the TUI is unimplemented. `ClaudeCliSession.ask()` will time out if Claude pauses to ask for permission. Don't use it for agent flows.
