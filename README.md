# Agon

**AIs compete. The best code wins.**

Agon is a competitive AI orchestration framework. Give it a task and a test — it dispatches multiple AI engines in parallel, each working in an isolated git worktree, scores every solution, and applies the winner. Losers critique. The winner refines. ELO ratings track who's best at what over time.

*Agon (Greek) — contest, struggle, the arena where ideas fight.*

---

## Why Agon

Every other multi-AI framework is cooperative. LangChain, CrewAI, AutoGen — they chain AIs together and hope for the best. Agon takes the opposite approach: **competition drives quality**. When three engines race on the same task with the same fitness test, you get the best solution any of them can produce, not the average.

---

## Quick start

```bash
git clone https://github.com/cukas/Agon-AI.git
cd Agon-AI && npm install && npm run install:cli

agon                                              # launch interactive REPL
agon forge "add validation" --test "npm test"     # one-shot forge
agon brainstorm "best caching strategy?"          # confidence-bidding
agon leaderboard                                  # ELO rankings
```

Requires **Node.js >= 22**, at least one AI CLI installed, and a git repo to work in.

`npm run kern:compile` and `npm run build:cli` use the root-installed `@kernlang/*` family pinned in `package.json`, so every workspace package follows the same version. If you want to temporarily compile against a sibling checkout, use `npm run kern:compile:local`, `npm run build:cli:local`, or set `KERN_BIN=/abs/path/to/kern`.

If you only want to refresh the runnable local binary without relinking it, use:

```bash
npm run build:cli
```

This builds the CLI in the right dependency order:
`@agon/core` -> `@agon/forge` -> `@agon/adapter-cli` -> `@agon/cli`

---

## How it works

Type `agon` to start. **Cesar** — a persistent AI brain — receives everything you type, maintains full conversation context, and routes automatically:

```
> explain the auth flow                     → Cesar answers directly
> fix the login bug, test with npm test     → Cesar delegates to forge
> should we use REST or GraphQL?            → Cesar delegates to tribunal
> /forge add dark mode test with npm test   → explicit forge
```

Change your brain engine anytime: `/cesar codex`

### Interactive REPL

The REPL runs in a fullscreen terminal UI by default. Startup content and early chat history render from the top, and the composer stays directly under the content while everything still fits on screen. Once the transcript grows past the available height, the history becomes the scrollable region and the composer stays pinned underneath it.

Useful controls:

- `Ctrl+E` toggle expanded tool output
- `Ctrl+T` toggle thinking visibility
- `Ctrl+Y` copy the current selection or transcript
- `Ctrl+G` enter mouse-selection mode for native terminal copy
- `PageUp` / `PageDown` / `Home` / `End` navigate long transcripts

Mouse drag selection is supported in fullscreen mode, and transcript copy is character-precise for normal text rows.

---

## Forge — competitive code generation

The core of Agon. Multiple engines solve the same coding task, fitness-tested and ranked.

```
Stage 0  Baseline        Run fitness test on untouched code (sanity check)

Stage 1  Starter         One engine goes first
                         Score >= 88 → auto-accept, done

Stage 2  Challengers     Remaining engines compete with peek strategy:
                         Scout runs alone → scout's diff shared to followers
                         Followers build on it or diverge entirely
                         Each engine gets a role prompt based on ELO:
                           lead / challenger / specialist / newcomer

Stage 3  Synthesis       Close call (spread < 8)?
                         Losers critique the winner's patch
                         Winner refines → re-score → best version wins
                         ELO and engine memory updated
```

Add `--hardened` to enable the **gauntlet**: losing engines become breakers, writing tests to attack the winning patch. Valid attacks are saved to a corpus. The winner gets a repair window.

```bash
/forge add OAuth2 signin test with npm test --hardened
```

### Scoring

| Component   | Weight | Measures                            |
|-------------|--------|-------------------------------------|
| Correctness | 50%    | Passes the fitness test             |
| Quality     | 20%    | Lint warnings + code style          |
| Diff size   | 15%    | Fewer changed lines = better        |
| Focus       | 10%    | Fewer files changed = more surgical |
| Speed       | 5%     | Faster execution wins               |

### Role specialization

Engines get tailored prompts based on their ELO for the task class:

- **Lead** — top-rated, lead with your best
- **Challenger** — focus on what the lead might miss
- **Specialist** — lean into your proven strengths
- **Newcomer** — fresh perspective, diverge from convention

### Engine memory

Qualitative profiles built from forge outcomes:

```
claude:  Won 4/5 refactors. Thorough but verbose.
codex:   Lost feature forge 78 vs 92. Weakness: edge cases.
gemini:  Failed bugfix (fitness timeout). Improving on tests.
```

Used to inform role assignment and routing decisions.

---

## Brainstorm — confidence-bidding

All engines produce ranked drafts with approach, reasoning, tradeoffs, and confidence. Confidence is calibrated against actual win rate (30% self-report, 70% track record). Best answer wins.

```
/brainstorm what architecture for the notification system?
```

---

## Tribunal — multi-round AI debate

Engines argue from assigned positions across multiple rounds, then Agon synthesizes the best arguments.

```
/tribunal adversarial should we migrate to microservices?
/tribunal steelman is our auth model secure enough?
/tribunal red-team review the deployment pipeline
```

Modes: `adversarial` `socratic` `red-team` `steelman` `synthesis` `postmortem`

---

## Campfire — collaborative thinking

No competition. All engines think together on a topic. Pure collaboration.

```
/campfire how should we approach the v2 API design?
```

---

## Team modes

Split engines into sides for team-based competition.

```
/team-forge 2v2 add rate limiting test with npm test
/team-tribunal 3v3 adversarial should we rewrite in Rust?
/team-brainstorm 2v2 best approach for real-time sync?
```

Each team runs: Architect -> Implementers (parallel) -> Reviewer -> Finalize. Both teams scored by the same fitness test. Team ELO tracked separately.

---

## All commands

| Command | What it does |
|---------|-------------|
| `/forge <task> test with <cmd> [--hardened]` | Competitive code generation |
| `/brainstorm <question>` | Confidence-bidding multi-AI answers |
| `/tribunal [mode] <question>` | Multi-round AI debate |
| `/campfire <topic>` | Collaborative thinking |
| `/build <task>` | Single agent builds in cwd |
| `/pipeline <task> [test with <cmd>]` | Build -> review -> fix loop |
| `/team-forge [2v2\|3v3] <task> test with <cmd>` | Team code competition |
| `/team-tribunal [2v2\|3v3] [mode] <question>` | Team debate |
| `/team-brainstorm [2v2\|3v3] <question>` | Team ideation |
| `/cesar <engine>` | Set the brain engine |
| `/use <engines>` | Set active engines |
| `/models` | Browse provider models, CLI models, and engine overrides |
| `/engine discover` | Auto-detect installed engines |
| `/provider [add\|remove\|list]` | Manage API providers |
| `/apply [path] [--force]` | Apply winning forge patch |
| `/commit [message]` | Stage and commit |
| `/leaderboard` | ELO rankings by engine and task class |
| `/history [id]` | Past forge runs |
| `/tokens` | Session token usage and costs |
| `/config [list\|get\|set]` | Settings |
| `/cp [N]` | Copy code block to clipboard |
| `/help` | All commands |

---

## Adding engines

Drop a JSON file in `~/.agon/engines/`. No code needed.

```json
{
  "schemaVersion": 3,
  "id": "deepseek",
  "displayName": "DeepSeek Coder",
  "binary": "deepseek",
  "searchPaths": ["/usr/local/bin", "${HOME}/.local/bin"],
  "isLocal": false,
  "tier": "user",
  "timeout": 180,
  "exec": { "args": ["--prompt", "{prompt}"] },
  "review": { "args": ["--prompt", "{prompt}", "--mode", "review"] }
}
```

Engines with a native protocol get faster dispatch via the companion field:

```json
{
  "companion": {
    "protocol": "jsonrpc",
    "serverCmd": ["app-server"],
    "features": { "threadResume": true, "nativeReview": true }
  }
}
```

### Builtin engines

| Engine | Type | Notes |
|--------|------|-------|
| Claude | Cloud | Anthropic Claude Code CLI |
| Codex | Cloud | OpenAI Codex CLI (JSONRPC companion) |
| Gemini | Cloud | Google Gemini CLI |
| OpenCode | Cloud | Multi-provider |
| Ollama | Local | Any local model |
| Aider | Hybrid | AI pair programming |
| OpenRouter | Cloud | 100+ models via proxy |
| Qwen | Cloud | Alibaba Qwen |
| Mistral | Cloud | Mistral AI |

Auto-detect what's installed: `/engine discover`

---

## Configuration

```bash
agon config set cesarEngine claude
agon config set forgeFixedStarter claude
agon config set forgeEnabledEngines claude,codex,gemini
agon config set forgeAutoAcceptScore 88
agon config set gauntletEnabled true
```

Three layers (later overrides earlier):

| Layer | File | Scope |
|-------|------|-------|
| Global | `~/.agon/config.json` | All projects |
| Project | `.agon.json` | This repo (commit it) |
| Personal | `.agon.local.json` | This repo (gitignored) |

### Key settings

| Setting | Default | What it controls |
|---------|---------|-----------------|
| `cesarEngine` | `claude` | Brain engine |
| `cesarMcpEnabled` | `false` | Enable MCP servers for Cesar companion sessions |
| `cesarMcpConfigPath` | `""` | JSON file with `mcpServers` or `servers` definitions |
| `forgeFixedStarter` | `claude` | Stage 1 engine |
| `forgeEnabledEngines` | `claude,codex,gemini` | Active forge engines |
| `forgeAutoAcceptScore` | `88` | Stage 1 auto-accept threshold |
| `forgeClearWinnerSpread` | `8` | Close-call trigger for synthesis |
| `forgeEnableSynthesis` | `true` | Enable Stage 3 |
| `forgeMaxCritiques` | `3` | Max critiques in synthesis |
| `gauntletEnabled` | `false` | Enable adversarial gauntlet |
| `gauntletMaxBreakers` | `3` | Max breaker engines |
| `eloEnabled` | `true` | Track ELO ratings |
| `eloKFactor` | `32` | ELO sensitivity |
| `timeout` | `360` | General timeout (seconds) |

### Cesar MCP

Enable it only when you actually want Cesar to have MCP tools. When disabled, Agon does not load the MCP config or add MCP guidance to Cesar's prompt.

```bash
agon config set cesarMcpEnabled true
agon config set cesarMcpConfigPath .vscode/mcp.json
```

Example `mcp.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}
```

### Lifecycle hooks

Run shell commands at key events:

```json
{
  "hooks": {
    "pre_dispatch": [{ "command": "echo dispatching", "engines": ["codex"] }],
    "post_forge": [{ "command": "notify-send 'Forge complete'" }],
    "session_start": [{ "command": "echo welcome" }]
  }
}
```

Events: `pre_dispatch` `post_dispatch` `pre_forge` `post_forge` `pre_brainstorm` `post_brainstorm` `pre_tribunal` `post_tribunal` `session_start` `session_end`

### Dynamic skills

Drop markdown files in `~/.agon/skills/` to create custom slash commands:

```markdown
---
name: Review PR
trigger: /review-pr
description: Review the current PR with all engines
---
Review the changes in this PR. Focus on bugs, security, and performance.
Context: {input}
```

They show up in the slash picker and ghost text automatically.

---

## Persistence

| Path | What |
|------|------|
| `~/.agon/config.json` | Global config |
| `~/.agon/elo.json` | ELO ratings (global + per-task-class) |
| `~/.agon/team-elo.json` | Team ELO ratings |
| `~/.agon/engine-memory.json` | Qualitative engine profiles |
| `~/.agon/corpus.json` | Validated gauntlet attacks |
| `~/.agon/runs/` | Forge manifests (historical) |
| `~/.agon/skills/` | Custom skill files |
| `~/.agon/engines/` | Custom engine definitions |

---

## Architecture

Written in **KERNlang** — all logic in `.kern` source files, compiled to TypeScript.

```
packages/
  core/           Types, scoring, ELO, engine registry, git, process spawner,
                  prompt builder, config, hooks, skills, session context,
                  sidechain logger, engine memory, role specialization,
                  companion JSONRPC dispatch

  forge/          Forge orchestrator, stages with peek strategy, synthesis,
                  brainstorm, tribunal, campfire, fitness, gauntlet, corpus,
                  team-forge, team-tribunal, team-brainstorm

  adapter-cli/    CLI adapter with fallback chain:
                  Companion (JSONRPC) -> API -> CLI spawn

  cli/            Interactive REPL (React/Ink), Cesar brain, intent detection,
                  handlers, streaming, slash commands, dynamic skills,
                  ghost text, conversational UX
```

---

## License

MIT
