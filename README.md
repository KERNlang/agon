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
- At least one supported AI CLI installed globally (e.g., Claude Code, Codex, Gemini CLI) or an API key for API-based engines.

## Installation

Agon is designed to be run from source in its public beta phase. 

```bash
# 1. Clone the repository
git clone https://github.com/your-org/agon-ai.git
cd agon-ai

# 2. Install dependencies
npm install

# 3. Build and install the global CLI
npm run install:cli
```

Once installed, simply run `agon` in any git repository to start the interactive REPL.

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

## Interactive REPL

Launching `agon` starts a powerful terminal REPL equipped with native scrollback, command history, and a file rail. 

Available commands include: `/forge`, `/brainstorm`, `/tribunal`, `/campfire`, `/pipeline`, `/review`, `/agent`, `/speculate`, `/team-forge`, `/status`, `/leaderboard`, `/history`, `/config`, `/plan`, `/models`, `/engines`, `/help`, and `/exit`.

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

Agon is built using **KERN**, a structured internal language that compiles down to highly optimized TypeScript. The monorepo consists of `packages/core` (types, config, ELO scoring), `packages/cli` (the interactive REPL, UI surfaces, and command handlers), `packages/forge` (competition and worktree logic), and `packages/adapter-cli` (engine integrations). The entire project leverages ESM, strict TypeScript, and is thoroughly tested with Vitest.

## License

This project is licensed under the MIT License.