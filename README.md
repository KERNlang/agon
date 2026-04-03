# Agon

**Competitive AI orchestration framework.** Multiple AI engines race on the same task, fitness-tested and scored — the best output wins.

*Agon (Greek: "contest") — the struggle, the competition, the arena.*

## What it does

```
You: "Add input validation to the signup form"
Agon: Dispatches Claude, Codex, Gemini (or any engine) in parallel
      Each works in an isolated git worktree
      Runs your fitness test against each solution
      Scores: correctness, quality, diff size, focus, speed
      Winner gets applied. Losers critique. Synthesis refines.
      ELO ratings track who's best at what, over time.
```

No existing framework does this. LangChain, CrewAI, AutoGen — all cooperative. Agon is **adversarial**. AIs compete. The best code wins.

## Quick start

```bash
git clone https://github.com/cukas/Agon-AI.git
cd Agon-AI && npm install && npm run build

# Launch the interactive REPL
agon

# Or use CLI commands directly
agon forge "add validation" --test "npm test"
agon brainstorm "what architecture for notifications?"
agon leaderboard
```

## Interactive REPL

Just type `agon` to start. Cesar (the orchestrator brain) routes your input automatically:

```
> explain the auth flow                    → Cesar answers directly
> fix the login bug, test with npm test    → Cesar delegates to forge
> should we use REST or GraphQL?           → Cesar delegates to tribunal
> /brainstorm best approach for caching?   → Explicit brainstorm
> /forge add dark mode test with npm test  → Explicit forge
```

### Cesar — the persistent brain

Cesar is a persistent AI session (configurable engine, default: Claude) that:
- Receives **all** user input first
- Maintains full conversation context across interactions
- Answers directly when it can (fast chat)
- Delegates to forge/build/brainstorm/tribunal when multi-engine collaboration helps
- Gets delegate results back for synthesis

Change your Cesar engine: `/config set cesarEngine codex`

### Slash commands

| Command | Description |
|---------|-------------|
| `/forge <task> test with <cmd>` | Competitive code generation |
| `/brainstorm <question>` | Confidence-bidding multi-AI answers |
| `/tribunal [mode] <question>` | Multi-round AI debate |
| `/campfire <topic>` | Collaborative thinking (no competition) |
| `/build <task>` | Agent builds in cwd (reads/edits/tests) |
| `/pipeline <task>` | Build → review → fix loop |
| `/commit [message]` | Stage & commit with auto-generated message |
| `/use <engines>` | Set active engines (e.g. `/use claude,codex`) |
| `/models` | Interactive engine picker |
| `/leaderboard` | ELO rankings |
| `/history [id]` | Past forge runs |
| `/tokens` | Session token usage & costs |
| `/config [list\|get\|set]` | Settings |
| `/cp [N]` | Copy code block N to clipboard |
| `/help` | Show all commands |

### Dynamic skills

Drop markdown files in `~/.agon/skills/` to add custom slash commands:

```markdown
---
name: Review PR
trigger: /review-pr
description: Review the current PR with all engines
---
Review the changes in this PR. Focus on bugs, security issues, and performance.

Context: {input}
```

The skill appears in the slash picker and ghost text automatically.

## How forge works

```
Stage 0: Baseline     Fitness test on untouched code (sanity check)

Stage 1: Starter      One engine goes first (configurable)
                      Score >= 88? → Auto-accept. Done.

Stage 2: Challengers  Remaining engines run with mid-forge peek:
                      - Scout (first challenger) runs alone
                      - Scout's diff shared as PEEK context to followers
                      - Followers can build on or diverge from scout's approach
                      - Each engine gets a specialized role prompt
                        (lead / challenger / specialist / newcomer)

Stage 3: Synthesis    Close call? Losers critique winner's diff
                      Winner refines. Re-score. Best version wins.

                      ELO + engine memory updated.
```

### Role specialization

Engines get different prompts based on their ELO per-task-class:
- **Lead**: "You're top-rated for this task type. Lead with your best."
- **Challenger**: "Focus on what the lead might miss: edge cases, pitfalls."
- **Specialist**: "Your win rate is X%. Focus on what you do best."
- **Newcomer**: "Fresh perspective — don't follow conventional patterns."

### Engine memory

Qualitative profiles built from forge outcomes over time:
```
claude: Won 4 of 5 refactor tasks. Tendency: thorough but verbose.
codex:  Lost feature forge (score 78 vs 92). Weakness: edge cases.
gemini: Failed bugfix forge (didn't pass fitness). Timeout issues.
```

Used to inform role assignment and routing decisions.

## Scoring

| Component | Weight | What it measures |
|-----------|--------|------------------|
| Correctness | 50% | Does it pass the fitness test? |
| Quality | 20% | Lint warnings + code style |
| Diff size | 15% | Fewer changed lines = better |
| Focus | 10% | Fewer files changed = more surgical |
| Speed | 5% | Faster is slightly better |

## Adding engines

Drop a JSON file in `~/.agon/engines/`. No code needed.

```json
{
  "schemaVersion": 3,
  "id": "deepseek",
  "displayName": "DeepSeek Coder",
  "binary": "deepseek",
  "searchPaths": ["/usr/local/bin", "${HOME}/.local/bin"],
  "versionCmd": ["--version"],
  "isLocal": false,
  "tier": "user",
  "timeout": 180,
  "exec": { "args": ["--prompt", "{prompt}"] },
  "review": { "args": ["--prompt", "{prompt}", "--mode", "review"] },
  "model": { "configKey": "deepseek_model", "flag": "--model" },
  "env": { "DEEPSEEK_API_KEY": { "required": true } }
}
```

Engines with native protocols get a `companion` field for faster, more stable dispatch:

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

| Engine | Binary | Type | Notes |
|--------|--------|------|-------|
| Claude | `claude` | Cloud | Anthropic Claude Code CLI |
| Codex | `codex` | Cloud | OpenAI Codex CLI (JSONRPC companion) |
| Gemini | `gemini` | Cloud | Google Gemini CLI |
| OpenCode | `opencode` | Cloud | Multi-provider AI |
| Ollama | `ollama` | Local | Any local model |
| Aider | `aider` | Hybrid | AI pair programming |
| OpenRouter | `openrouter` | Cloud | 100+ models via proxy |
| Qwen | `qwen` | Cloud | Alibaba Qwen |
| Mistral | `mistral` | Cloud | Mistral AI |

## Configuration

```bash
agon config set cesarEngine claude          # Which engine is the brain
agon config set forgeFixedStarter claude     # Which engine starts forge
agon config set forgeEnabledEngines claude,codex,gemini
```

Three config layers (later overrides earlier):
1. `~/.agon/config.json` — global defaults
2. `.agon.json` — project config (committed)
3. `.agon.local.json` — personal overrides (gitignored)

### Lifecycle hooks

Define hooks in config to run shell commands at dispatch lifecycle points:

```json
{
  "hooks": {
    "pre_dispatch": [{ "command": "echo dispatching", "engines": ["codex"] }],
    "post_dispatch": [{ "command": "notify-send 'Done'" }],
    "session_start": [{ "command": "echo welcome" }]
  }
}
```

Hook events: `pre_dispatch`, `post_dispatch`, `pre_forge`, `post_forge`, `pre_brainstorm`, `post_brainstorm`, `pre_tribunal`, `post_tribunal`, `session_start`, `session_end`

## Architecture

Written in **KERNlang** — all logic in `.kern` source files, compiled to TypeScript.

```
packages/
├── core/          @agon/core — types, scoring, ELO, engine registry, git,
│                  process spawner, prompt builder, config, hooks, skills,
│                  session context, sidechain logger, engine memory,
│                  role specialization, companion JSONRPC dispatch
│
├── forge/         @agon/forge — forge orchestrator, stages (with peek),
│                  synthesis, brainstorm, tribunal, campfire, fitness
│
├── adapter-cli/   @agon/adapter-cli — CLI adapter with companion protocol
│                  fallback chain: JSONRPC → API → CLI spawn
│
└── cli/           @agon/cli — interactive REPL (React/Ink), Cesar brain,
                   intent detection, handlers, conversational UX,
                   streaming, slash commands, dynamic skills
```

## Requirements

- Node.js >= 22
- At least one AI CLI tool installed (claude, codex, gemini, ollama, etc.)
- A git repository to work in (forge uses worktrees)

## License

MIT
