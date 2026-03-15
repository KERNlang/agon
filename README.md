# Agon

**Competitive AI orchestration framework.** Multiple AI engines race on the same task, fitness-tested and scored — the best output wins.

*Agon (Greek: "contest") — the struggle, the competition, the arena.*

## What it does

```
You: "Add input validation to the signup form"
Agon: Dispatches Claude, Codex, Gemini (or any engine) in parallel
      Each works in an isolated git worktree
      Runs your fitness test against each solution
      Scores: correctness (50%), quality (20%), diff size (15%), focus (10%), speed (5%)
      Winner gets applied. Losers critique. Synthesis refines.
      ELO ratings track who's best at what, over time.
```

No existing framework does this. LangChain, CrewAI, AutoGen — all cooperative. Agon is **adversarial**. AIs compete. The best code wins.

## Quick start

```bash
# Install
git clone https://github.com/cukas/Agon-AI.git
cd Agon-AI
npm install && npm run build

# See what engines you have
npx agon engine list

# Run a forge — engines compete on your task
npx agon forge "add input validation to signup form" --test "npm test"

# Brainstorm — engines bid on confidence, highest answers
npx agon brainstorm "what architecture should we use for the notification system?"

# Check the leaderboard
npx agon leaderboard
```

## How forge works

```
Stage 0: Baseline     Run fitness on untouched code (sanity check)
                       │
Stage 1: Starter       One engine goes first (configurable)
                       │
            ┌──────────┴──── Score ≥ 88, lint ≤ 2, style ≥ 90?
            │                     │
          YES ── Auto-accept      NO
                                  │
Stage 2: Challengers   Remaining engines run in parallel
                       │
                       ├── Score all engines
                       ├── Deterministic tiebreaker
                       │   (score → lint → style → diff → files → speed)
                       │
            ┌──────────┴──── Close call? (spread < 8 points)
            │                     │
           NO ── Winner wins     YES
                                  │
Stage 3: Synthesis     Losers critique winner's diff
                       Winner refines based on valid critiques
                       Re-score — if better, synthesis wins
                       │
                       └── ELO ratings updated
```

## Scoring

| Component | Weight | What it measures |
|-----------|--------|------------------|
| **Correctness** | 50% | Does it pass the fitness test? |
| **Quality** | 20% | Lint warnings + code style |
| **Diff size** | 15% | Fewer changed lines = better (avoids over-engineering) |
| **Focus** | 10% | Fewer files changed = more surgical |
| **Speed** | 5% | Faster is slightly better |

Hard filters: fail = 0 score. Empty diff = 0 score.

## Adding engines

Drop a JSON file in `~/.agon/engines/`. No code needed.

```json
{
  "schemaVersion": 2,
  "id": "deepseek",
  "displayName": "DeepSeek Coder",
  "binary": "deepseek",
  "searchPaths": ["/usr/local/bin", "${HOME}/.local/bin"],
  "versionCmd": ["--version"],
  "isLocal": false,
  "tier": "user",
  "timeout": 180,

  "exec": {
    "args": ["--prompt", "{prompt}"]
  },
  "review": {
    "args": ["--prompt", "{prompt}", "--mode", "review"]
  },

  "model": {
    "configKey": "deepseek_model",
    "flag": "--model",
    "default": "deepseek-coder-v2"
  },

  "env": {
    "DEEPSEEK_API_KEY": { "required": true }
  }
}
```

Template variables: `{prompt}`, `{model}`, `{cwd}`, `{timeout}`

### Builtin engines

| Engine | Type | Binary | Notes |
|--------|------|--------|-------|
| Claude | Cloud | `claude` | Anthropic Claude Code CLI |
| Codex | Cloud | `codex` | OpenAI Codex CLI |
| Gemini | Cloud | `gemini` | Google Gemini CLI |
| Ollama | Local | `ollama` | Any local model (Llama, Qwen, Mistral, Phi...) |
| Aider | Hybrid | `aider` | AI pair programming, any backend model |
| OpenRouter | Cloud | `openrouter` | 100+ models via proxy |
| Qwen | Cloud | `qwen` | Alibaba Qwen |
| Mistral | Cloud | `mistral` | Mistral AI |

## Commands

```bash
agon forge <task> --test <cmd>     # Competitive forge — engines race
agon brainstorm <question>         # Confidence-bidding brainstorm
agon tribunal <question>           # Adversarial debate — engines argue sides
agon history                       # Browse past forge runs
agon history <id>                  # Show details for a specific run
agon engine list                   # Show detected engines
agon engine info <id>              # Engine details + ELO
agon leaderboard                   # Global ELO rankings
agon leaderboard -c bugfix         # Per-task-class rankings
agon config list                   # Show all config
agon config set <key> <value>      # Set config value
```

### Tribunal — adversarial debate

Engines take opposing positions and debate across multiple rounds. Each round sees the previous arguments. A final verdict synthesizes the debate.

```bash
# 2 engines debate, 2 rounds (default)
agon tribunal "should we use microservices or a monolith?"

# 3 engines, 3 rounds
agon tribunal "REST vs GraphQL vs tRPC" -r 3 -e claude,codex,gemini
```

## Configuration

```bash
# Set via CLI
agon config set forgeFixedStarter claude
agon config set forgeEnabledEngines claude,codex,gemini
agon config set eloKFactor 32

# Or edit ~/.agon/config.json directly
```

| Key | Default | Description |
|-----|---------|-------------|
| `forgeAutoAcceptScore` | 88 | Stage 1 auto-accept threshold |
| `forgeClearWinnerSpread` | 8 | Close-call threshold (triggers synthesis) |
| `forgeEnableSynthesis` | true | Enable critique + refinement |
| `forgeMaxCritiques` | 3 | Max critiques per loser |
| `forgeStarterStrategy` | "fixed" | "fixed" or "rotate" |
| `forgeFixedStarter` | "claude" | Preferred starter engine |
| `forgeEnabledEngines` | claude,codex,gemini | Which engines to use |
| `eloEnabled` | true | Track ELO ratings |
| `eloKFactor` | 32 | ELO sensitivity |

## Architecture

```
packages/
├── core/          @agon/core — zero runtime deps
│   ├── types.ts           Interfaces (Engine, Scoring, ELO, Forge)
│   ├── scoring.ts         Composite scorer (50/20/15/10/5)
│   ├── elo.ts             ELO ratings (K=32, per-task-class)
│   ├── engine-registry.ts Engine discovery + binary lookup
│   ├── task-classifier.ts Keyword-based task classification
│   ├── git.ts             Worktree create/remove/diff
│   ├── process.ts         Spawn with timeout + cleanup
│   ├── prompt-builder.ts  All prompt templates
│   ├── config.ts          ~/.agon/ + .agon.json config
│   ├── logger.ts          Structured debug logger
│   └── errors.ts          Typed error hierarchy
│
├── forge/         @agon/forge — orchestrator
│   ├── forge.ts           runForge() — 3-stage pipeline
│   ├── stages.ts          Baseline, Stage 1, Stage 2, winner logic
│   ├── fitness.ts         Run fitness cmd + gather stats
│   ├── synthesis.ts       Critique collection + refinement
│   ├── brainstorm.ts      Confidence bidding
│   └── manifest.ts        Run history persistence
│
├── adapter-cli/   @agon/adapter-cli — declarative CLI adapter
│   └── adapter.ts         Reads args from engine JSON, interpolates
│
└── cli/           @agon/cli — CLI commands
    └── commands/          forge, brainstorm, leaderboard, engine, config
```

## Ported from

Agon is a TypeScript port of [Claude's AI Buddies](https://github.com/cukas/claudes-ai-buddies) — a 918-line bash library with 105 tests and production usage. The name was chosen via 3-AI brainstorm consensus.

## Requirements

- Node.js >= 22
- At least one AI CLI tool installed (claude, codex, gemini, ollama, aider, etc.)
- A git repository to work in (forge uses worktrees)

## License

MIT
