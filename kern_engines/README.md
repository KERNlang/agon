# @agon/kern-engines

Engine substrates that drive third-party CLI agents on behalf of agon. **Lives in agon, not in KERN core** — engine orchestration is application policy, not language (tribunal verdict, locked).

This is a polyglot package: a **TypeScript shell** and a **Python implementation** sit side-by-side. The Python implementation is canonical; the TS shell is a thin subprocess wrapper that spawns the Python daemon and proxies messages over stdin/stdout as NDJSON. One source of truth, zero native Node dependencies.

## Why this exists

Anthropic is changing `claude --print` in June: the subscription-tier free `-p` is going away, and paid `-p` bills SDK credits. We refuse to pay credits when the user is already paying for the Claude subscription. The interactive `claude` TUI runs against the subscription session — same as a human typing — so if we drive it via a pty, we keep the existing billing path. Anthropic literally cannot distinguish a pty from a real TTY; it's the same kernel primitive `tmux`, `mosh`, `asciinema` all use.

`--print`, the `--ide` WebSocket protocol, and the `setup-token` flow are all separately metered. **pty is the only undetectable channel.** That's why we lean on it.

AI-Buddies, agon, kern-sight, and codex-calling-claude flows all depend on this working.

## Architecture

```
┌─ adapter-cli (TS, in agon) ────────────────────────────────┐
│  dispatch / dispatchStream / dispatchAgent / *AgentStream  │
│       ↓                                                    │
│  runClaudePtyDispatch  (lazy-import @agon/kern-engines)    │
└────────┬───────────────────────────────────────────────────┘
         │ spawn one PtyCliSession per dispatch
         ↓
┌─ @agon/kern-engines/cli/claude.ts  (TS shell) ─────────────┐
│  spawnProcess('python3', ['-m', 'kern_engines.cli.daemon', │
│                            'claude', '--mode', 'agent'])   │
│  NDJSON over stdin/stdout                                  │
└────────┬───────────────────────────────────────────────────┘
         │ stdio JSON-RPC
         ↓
┌─ kern_engines/cli/daemon.py ───────────────────────────────┐
│  one PtyTuiSession alive for the life of the daemon        │
└────────┬───────────────────────────────────────────────────┘
         │ pty.fork() + os.execvp("claude", ...)
         ↓
┌─ claude (interactive TUI) ──────────────────────────────────┐
│  subscription billing — same as a human at the keyboard     │
└─────────────────────────────────────────────────────────────┘
```

## Layout

```
kern_engines/
├── README.md
├── package.json            # @agon/kern-engines  (npm workspace)
├── pyproject.toml          # kern-engines        (Python package)
├── tsconfig.json
├── tsup.config.ts
├── __init__.py
├── index.ts                # TS barrel
└── cli/
    ├── __init__.py
    ├── pty_session.py      # generic PtyTuiSession + EngineConfig
    ├── configs.py          # per-engine EngineConfig instances + REGISTRY
    ├── daemon.py           # stdio JSON-NDJSON daemon
    ├── claude.py           # back-compat ClaudeCliSession alias
    ├── session.ts          # generic TS PtyCliSession (spawns daemon)
    └── claude.ts           # ClaudeCliSession TS shim
```

## Public surface

### Python (canonical)

```python
from kern_engines.cli.claude import ClaudeCliSession

with ClaudeCliSession() as cs:
    reply = cs.ask("hello, can you say 'pong'?")

# Or via the generic class:
from kern_engines.cli.pty_session import PtyTuiSession
from kern_engines.cli.configs import CLAUDE

with PtyTuiSession(CLAUDE, mode="agent") as cs:
    reply = cs.ask("edit greeting.txt: hello world → hello pong")

# Streaming:
with ClaudeCliSession() as cs:
    chunks = list(cs.ask_stream("hello"))
    # cs.ask_stream is a generator; final clean response is the
    # StopIteration.value, deltas are intermediate snapshots.
```

### TypeScript

```ts
import { ClaudeCliSession } from '@agon/kern-engines/cli/claude';

const cs = await ClaudeCliSession.spawn({ cwd: '/path/to/workspace' });
try {
  const reply = await cs.ask("hello");

  // Streaming:
  const gen = cs.askStream("explain this");
  while (true) {
    const next = await gen.next();
    if (next.done) {
      const finalClean = next.value;
      break;
    }
    process.stdout.write(next.value);
  }
} finally {
  await cs.close();
}
```

## Install

### Python

```sh
python3 -m pip install --user pyte
```

`pyte` is no longer on the hot path (the probe and session classes use raw bytes — pyte hung on Claude's TUI byte stream). It's still listed as a dependency for future use, but the substrate works without it.

A `pyproject.toml` is provided for `pip install -e kern_engines`.

### Node / TypeScript

**No native dependencies.** The TS shell only spawns `python3` as a subprocess; there is no `node-pty`, no `@xterm/headless`, and no native build step. Make sure `python3` is on `$PATH` and `kern_engines/` is importable (either via the workspace's relative path, or via `pip install -e`).

## Wiring into adapter-cli

`packages/adapter-cli` routes `claude` dispatch through `runClaudePtyDispatch` by default for all four dispatch methods:

| method | mode | notes |
|---|---|---|
| `dispatch` | `exec` | one-shot chat-style turn |
| `dispatchStream` | `exec` | yields deltas, returns clean final |
| `dispatchAgent` | `agent` | `--dangerously-skip-permissions` + cwd-diff capture |
| `dispatchAgentStream` | `agent` | streaming variant of the above |

Opt-outs:

```sh
AGON_CLAUDE_PRINT=1 agon ...   # fall back to legacy `claude --print` path
                                # (works today; will start billing SDK credits in June)
```

If `kern_engines` is missing or `python3` isn't on PATH, the helper returns `{ unavailable: true }` and the legacy CLI path takes over. **The pty path never throws** — any unexpected error becomes `unavailable: true` so the kern call-sites can fall through with a simple `!result.unavailable` check.

## Adding a new engine

When (not if) another vendor pushes their CLI off subscription-friendly billing, adding pty support is two files:

1. **`kern_engines/cli/configs.py`** — define an `EngineConfig`:

    ```python
    CODEX = EngineConfig(
        id="codex",
        binary="codex",
        prompt_marker_bytes=b"▶",         # whatever codex shows when ready
        response_marker="◆",              # whatever prefixes its assistant text
        chrome_regex=r"(?:status|tokens?\)|...)",
        env_strip=("CODEX_SESSION_ID", "..."),
        agent_extra_argv=("--auto-edit", "--skip-git-check"),
    )

    REGISTRY[CODEX.id] = CODEX
    ```

2. **`kern_engines/cli/codex.ts`** — five-line TS wrapper:

    ```ts
    import { PtyCliSession, type SpawnOptions } from './session.js';

    export class CodexCliSession {
      private constructor(private inner: PtyCliSession) {}
      static async spawn(opts: SpawnOptions = {}) {
        return new CodexCliSession(await PtyCliSession.spawn('codex', opts));
      }
      ask(p: string, t = 60_000) { return this.inner.ask(p, t); }
      askStream(p: string, t = 60_000) { return this.inner.askStream(p, t); }
      close() { return this.inner.close(); }
    }
    ```

3. **`packages/adapter-cli/src/kern/adapter-helpers.kern`** — rename `shouldUseClaudePty` to `shouldUsePty` and check `engine.id in PTY_REGISTRY`. Or add a parallel `shouldUseCodexPty` if you prefer per-engine env-var control.

That's it. No new pty plumbing, no new daemon, no new IPC layer.

## Phase 0 probe

A standalone bytes-only probe lives at `scripts/claude-tui-probe.py`:

```sh
python3 -m pip install --user pyte
python3 scripts/claude-tui-probe.py "reply with exactly: pong"
```

Validated the substrate before any agon integration: returns `pong`, exit 0, no zombies, no SDK credits.

**Do not run inside an existing Claude Code session.** Run from a plain shell.

## Hard constraints (honoured throughout)

- **ANSI sanitisation on input.** ESC and other C0 control bytes (except TAB/LF) plus DEL are stripped from prompts before write. Defensive against LLM-generated prompts that contain terminal escapes.
- **Response-end detection is heuristic.** Idle window + response-marker presence + hard timeout. None alone is trusted. Tuned per engine; `agent_response_idle_ms` defaults to 4s because tool loops pause longer than chat turns.
- **Cleanup is bounded.** SIGTERM → 2s grace → SIGKILL → 1s reap → close fd → done. Idempotent. `with`-statement (Python) / `try/finally` (TS) covers every exit path. A common Claude TUI pattern is to spawn helpers that keep the pty alive after the main process dies — the bounded reap means we don't hang on that.
- **Single in-flight `ask()` per session.** Lock (Python) / busy flag (TS) serialises calls.
- **No native Node deps.** Avoids node-pty's build toolchain requirements and the `@xterm/headless` parser hangs we hit earlier.

## ToS-risk findings

- Anthropic's subscription terms permit a real human delegating their session but don't explicitly bless automated drivers. The pty path is a gray area.
- Mitigations baked in: single-session-per-process, hard timeouts, no parallel-spawn helper, no "burst" mode.
- Don't publish abuse-friendly docs (high-throughput drivers, credential rotation, automated farms).
- Don't redistribute Claude responses as a service paid by third parties — that crosses delegation into redistribution.
- Anthropic may add detection for non-TTY drivers, but distinguishing a pty from a real TTY from inside the process is fundamentally impossible — `tmux`, `mosh`, `asciinema` are indistinguishable for the same reason.

## Known limitations

- **Streaming is coarse.** Claude's TUI doesn't expose token-level streaming externally; it renders the full assistant block in one or two frames after the spinner. `askStream` yields a handful of deltas per turn, not per token. Use it for live-progress UX; use `ask` when you just need the final text.
- **Agent mode trusts the workspace.** `--dangerously-skip-permissions` bypasses the workspace trust dialog. The caller is opting in by routing through agent dispatch — same trust contract as the legacy `--print` agent path.
- **One session per dispatch.** adapter-cli spawns + closes a session for each dispatch, so the daemon's startup (~2s) is paid every turn. A future optimisation is to pool daemons per `(engine, cwd, mode)`.
