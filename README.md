# Agon AI

![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

**The competitive multi-AI orchestration CLI.**

Agon AI pits the world's best AI engines against each other to solve your software engineering problems. Multiple AI engines compete in isolated git worktrees on the exact same task, the best solution wins and is applied automatically, and ELO ratings continuously track each model's performance over time. 

---

## Table of Contents

- [What is Agon?](#what-is-agon)
- [Requirements](#requirements)
- [Installation](#installation)
- [Core Modes](#core-modes)
- [Interactive REPL](#interactive-repl)
- [Using Agon from Other CLIs](#using-agon-from-other-clis)
- [Engines](#engines)
- [Cesar Routing](#cesar-routing)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [License](#license)

---

## What is Agon?

Agon AI fundamentally changes how developers interact with AI coding assistants. Instead of relying on a single model and hoping for the best, Agon introduces **competitive orchestration**. You describe the task once, and Agon dispatches it to multiple models simultaneously. They race to implement the solution, and you review and apply the best outcome. 

Under the hood, Agon uses a sophisticated **worktree isolation model**. When a competition begins, Agon creates temporary, hidden git worktrees for each participating engine. This ensures that engines can modify files, run tests, and iterate without stepping on each other's toes or cluttering your main working directory. Only the winning implementation is merged back into your active branch.

Routing these tasks efficiently is **Cesar**, Agon's intelligent orchestration brain. Cesar monitors every interaction, success, and failure, updating an internal **ELO scoring system** for each engine. Over time, Cesar learns which engines excel at specific task classes—like writing tests, refactoring React components, or optimizing database queries—and automatically routes future tasks to the highest-rated engine for that specific domain.

Agon isn't just about competition; it's a unified platform for AI collaboration. Whether you need engines to debate a controversial architectural decision, brainstorm solutions with weighted token allocations based on confidence, or simply execute a robust pipeline loop, Agon provides the ultimate terminal-native interface for multi-agent workflows.

## Requirements

- Node.js >= 22
- A Git repository
- At least one supported AI CLI installed globally (e.g., Claude Code, Codex, Gemini CLI) or an API key for API-based engines
- **Optional:** Python 3.10+ to unlock the semantic features that run as sidecars to KERN — semantic history search (`agon history --query`), tree-sitter syntax validation in forge fitness, brainstorm paraphrase dedup, and the task classifier. Agon still runs without Python; these features fall back to substring/regex paths.

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/KERNlang/agon.git
cd agon

# 2. Install dependencies (compiles KERN → TypeScript → JS)
npm install

# 3. Build and install the global CLI
npm run install:cli

# 4. (Optional) Install Python sidecars for semantic features
python3 -m pip install --user -r packages/dedup/requirements.txt
```

Once installed, run `agon` in any git repository to start the interactive REPL. Run `agon doctor` to verify every engine, the worktree path, and the Python sidecars resolve.

## Core Modes

Agon features multiple operational modes to suit different development challenges.

### Forge
Competitive code generation. Engines race on the exact same task in isolated git worktrees. The winner's changes are applied automatically to your main branch.

```bash
/forge "Implement a Redis caching layer for the user service"
```

### Brainstorm
Engines bid their confidence level on how they would tackle a complex problem. Engines with higher confidence bids are allocated more tokens and priority.

```bash
/brainstorm "How should we handle database migrations with zero downtime?"
```

### Tribunal
Engines debate a proposed solution, argue its flaws, and attempt to reach consensus. Available modes include: adversarial, socratic, red-team, steelman, synthesis, and postmortem.

```bash
/tribunal --mode red-team "Review the new authentication middleware for security flaws"
```

### Campfire
A relaxed, open-ended discussion mode where engines can collaborate without competitive scoring or tight token constraints.

```bash
/campfire "Let's discuss the pros and cons of migrating to GraphQL"
```

### Pipeline
A focused, single-engine build-review-fix loop ideal for deterministic tasks where competition isn't strictly necessary.

```bash
/pipeline "Fix all ESLint errors in the src/components directory"
```

### Review
Performs an automated, multi-engine code review of your uncommitted changes, specific branches, or recent commits.

```bash
/review HEAD~1..HEAD
```

### Agent
An autonomous agent loop that can operate solo or in shadow mode, automatically routed to the best engine by Cesar based on task requirements.

```bash
/agent "Investigate the memory leak in the worker process and fix it"
```

### Speculate
Parallel speculation where N engines attempt to solve a problem in isolated worktrees, and the first successful, test-passing winner is immediately applied.

```bash
/speculate --engines 3 "Write a script to backfill the missing user avatars"
```

### Team Competitions
Team-based variants of core modes (e.g., 2v2 or 3v3). Includes Team Forge, Team Tribunal, and Team Brainstorm for complex, multi-layered tasks.

```bash
/team-forge "Rewrite the frontend to use Tailwind CSS"
```

### Goal
Autonomous, long-running orchestration. You hand Agon a finite, checkable task queue (e.g. a directory of gap specs) plus a green **gate** command, and it drives the whole queue to completion unattended — for hours. Each task runs in a throwaway worktree off a dedicated `goal/` branch: an engine implements the change, every new test is **witnessed** (it must fail on the base commit and pass on the new one) and **mutation-witnessed** (canonical mutants on the changed lines must die — which defeats tautological "encode the answer" tests), the frozen gate runs once, an ensemble review gates the commit, and only then does **one commit per task** land on the goal branch. Any failure discards the worktree wholesale (atomic rollback). The run is journaled and resumable (`--resume`), checkpoints cleanly on Ctrl-C, and **never auto-pushes** — you review the commits and open the PR.

```bash
agon goal "Close all KERN gaps" \
  --queue .kern-gaps/ \
  --gate "npm run build && npm run typecheck && npm test" \
  --branch goal/close-gaps \
  --maxHours 8
```

Read a run's digest from any session with `agon goal --status --id close-all-kern-gaps`. _(P0: `--maxHours` is the live wall-clock ceiling; USD budgeting and hermetic gate isolation are on the roadmap.)_

## Interactive REPL

Launching `agon` starts a powerful terminal REPL equipped with native scrollback, command history, and a file rail. 

Available commands include: `/forge`, `/brainstorm`, `/tribunal`, `/campfire`, `/pipeline`, `/review`, `/agent`, `/speculate`, `/team-forge`, `/status`, `/leaderboard`, `/history`, `/config`, `/plan`, `/models`, `/engines`, `/doctor`, `/help`, and `/exit`.

**Example Session:**
```text
$ agon
Agon > /leaderboard
1. Claude 3.7 Sonnet (ELO: 1650)
2. Gemini 2.5 Pro    (ELO: 1590)
3. GPT-4o            (ELO: 1540)

Agon > /forge "Extract the routing logic into a separate module"
[Cesar] Routing to Claude 3.7 Sonnet and Gemini 2.5 Pro based on ELO.
[Forge] Initializing isolated worktrees...
[Forge] Engines are racing...
[Forge] Claude 3.7 Sonnet completed in 45s.
[Forge] Gemini 2.5 Pro completed in 52s.
[Forge] Winner: Claude 3.7 Sonnet. Applying patch...
Agon > 
```

## Using Agon from Other CLIs

Agon can also be called from other AI CLIs such as Claude Code, Codex, and Gemini. The fastest path is the shell bridge:

```bash
agon call tribunal "Should we ship this architecture?" --team --tribunalMode red-team
agon call brainstorm "How should we design the plugin API?" --team
agon call review
agon call forge "Implement the cache layer" --test "npm test" --team
```

`agon call` streams the underlying Agon workflow into the caller's terminal, so the calling CLI can show live progress and the other engines' output. Use `--jsonl` when the caller wants machine-readable lifecycle events:

```bash
agon call tribunal "Debate the migration plan" --team --jsonl
```

For MCP-capable clients, Agon also ships a stdio MCP server:

```bash
claude mcp add -s user agon -- node /path/to/Agon-AI/plugins/agon-orchestrator/scripts/agon-mcp.js
codex mcp add agon -- node /path/to/Agon-AI/plugins/agon-orchestrator/scripts/agon-mcp.js
```

After that, clients can call Agon tools such as Tribunal, Brainstorm, Forge, Campfire, Pipeline, and Review directly.

## Engines

Agon supports a wide variety of local and cloud-based AI engines out of the box. Supported engines include:

- **Claude** (Anthropic) - Requires `claude-code` CLI
- **Codex** (OpenAI)
- **Gemini** (Google) - Requires `gemini-cli`
- **Aider**
- **Ollama** (Local models)
- **OpenRouter**
- **Mistral**
- **Qwen**
- **MiniMax**
- **OpenCode**

Engine definitions are stored as JSON configurations in the `engines/` directory. You can easily toggle availability and set default models.

## Cesar Routing

**Cesar** is Agon's built-in orchestration layer. By default, you don't need to choose which engine to use; Cesar automatically routes your prompts to the best-performing engine based on historical ELO ratings tailored to specific task classes.

If you want manual control, you can easily override Cesar's routing:

```bash
# Override for a single command
/forge --engine claude "Update the README"

# Manually switch the active engine for the session
/cesar gemini
```

## Configuration

Global configuration, engine selection, model preferences, and telemetry settings are managed via your personal config file located at `~/.agon/AGON.md`. Project-specific settings can be defined in a local `AGON.md` within your repository.

## Architecture

Agon is built using **KERN**, a structured meta-language that compiles down to optimized TypeScript. Nearly the entire codebase — including Ink screens, signals, blocks, and orchestration logic — is authored in `.kern` files and regenerated via `npm run kern:compile`. The monorepo:

- `packages/core` — types, config, ELO/Glicko-2 scoring, Cesar routing, session state (100% KERN, 69 files)
- `packages/cli` — the interactive REPL, Ink surfaces, command handlers (~99% KERN, 60+ files)
- `packages/forge` — competitive worktree orchestration, fitness, M-of-N quorum finalize (100% KERN, 17 files)
- `packages/adapter-cli` — CLI engine integrations (100% KERN)
- `packages/dedup` — Python sidecars for semantic features (history search via fastembed/MiniLM, tree-sitter syntax validation, task classifier, brainstorm paraphrase dedup). Bridged from KERN via JSON over stdin/stdout — KERN imports Python where Python is strictly better than a TS/JS port.
- `packages/mcp` — exposes Agon's orchestration modes as MCP tools so other CLIs (Claude Code, Codex, Gemini) can drive Agon

The entire project is ESM, uses strict TypeScript, and is thoroughly tested with Vitest.

## License

This project is licensed under the MIT License.
