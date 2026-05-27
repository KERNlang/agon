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

### Which mode should I use?

Pick by the **shape** of the problem, not the topic:

| You need… | Use | Why |
|-----------|-----|-----|
| Ideas / options / "what am I missing?" | **brainstorm** | Cheap and fast — engines bid confidence and surface approaches and gaps. |
| One refined output from many opinions | **synthesis** | Engines draft, improve each other's drafts over swap rounds, and a judge picks the best evolved result. |
| A decision with real tradeoffs settled | **tribunal** | Structured debate (adversarial / steelman / socratic / red-team / synthesis / postmortem) that argues the sides. |
| Open exploration, no decision yet | **campfire** | Relaxed multi-engine discussion — no scoring, no winner. |
| A problem decomposed before you act | **think** | Sequential thinking — linear or reflexion (forced self-critique), optional branches; surfaces open questions + a `goal` handoff. |
| Your own decision pressure-tested | **nero** | Adversarial self-challenge — the top-rated *critic* (by tribunal rating, not the best builder) attacks it and returns a verdict. |
| Code built competitively against a test | **forge** | Engines race on the same task in isolated worktrees; the best test-passing patch is applied. |
| The **first** passing solution, fast | **speculate** | N engines race; the first to pass the test wins and is applied immediately. |
| A routine build with one engine | **pipeline** | Single-engine build → review → fix loop; no competition overhead. |
| Existing code checked for bugs | **review** | Multi-engine review folded into one confidence-tiered consensus. |
| A task done end-to-end autonomously | **agent** | One engine (Cesar-routed) runs a multi-turn tool loop to do the work. |
| A whole queue driven to "done" unattended | **goal** | Per task: build → witness → gate → review + judge → commit, for hours. |
| A big, multi-layered task | **team-\*** | 2v2 / 3v3 variants of forge / tribunal / brainstorm — engines collaborate per side. |

**Rule of thumb**

- Need ideas → `brainstorm`
- Need a decision debate → `tribunal`
- Need one refined output (plan, spec, PR description, architecture note, acceptance criteria, migration plan) → `synthesis`
- Need code checked → `review`
- Need code built competitively → `forge`
- Need the first green solution fast → `speculate`
- Need a task queue executed → `goal`
- Need to think a problem through before acting → `think`
- Need your own decision attacked before you commit → `nero`

**forge vs. speculate vs. synthesis** — all three run multiple engines, but they pick the winner differently:
- **forge** *scores* every candidate against the test and applies the best.
- **speculate** takes the *first* candidate that passes — fastest path to any correct answer.
- **synthesis** has engines *improve each other's* drafts and a judge picks the evolved winner — use it when there's no clean pass/fail test (plans, specs, prose, architecture).

### Forge
Competitive code generation. Engines race on the exact same task in isolated git worktrees. The winner's changes are applied automatically to your main branch.

```bash
/forge "Implement a Redis caching layer for the user service"
```

With synthesis enabled (`forgeEnableSynthesis`), a configurable **synthesizer** engine then refines the winner using the other engines' critiques into a best-of-all result — **Cesar** in the interactive REPL, the **judge** under `agon goal`, or any named engine elsewhere.

### Synthesis
Competitive cross-pollination. Engines draft independently, then improve each other's drafts in swap rounds before a judge picks the best evolved result.

```bash
/synthesis "Evolve this design doc into a concrete implementation plan" --swaps 2 --timeout 90
agon synthesis "Evolve this design doc into a concrete implementation plan" --swaps 2 --timeout 90
```

### Think
Native sequential thinking. One engine decomposes a problem into structured, numbered thoughts before any code is written — the scaffold forces it off the laziest answer. Opt-in and composable: it surfaces open questions and emits a refined spec you can hand straight to `agon goal`.

```bash
agon think "Should the rate limiter use a token bucket or a sliding window?"
agon think "Rework auth to JWT" --strategy reflexion             # force a self-critique + revision each step
agon think "Design the cache layer" --strategy tot --branches 5  # score 5 branches, keep the winner, prune the rest
agon think "Pick a storage engine" --strategy hypothesis         # competing hypotheses, eliminate the losers
agon think "..." --critic codex                                  # a SECOND engine adversarially attacks the chain
agon think "..." --json                                          # emit the ThinkResult (handoff artifact), pipe-friendly
agon goal "Close the gaps" --think --queue .gaps/ --gate "npm test"  # decompose + surface unknowns before the run
```

- **Strategies** (the method is a swappable `ThinkChain` state machine):
  - `linear` — classic sequential thinking.
  - `reflexion` — each step is force-followed by a critique then a revision (anti-laziness).
  - `tot` — tree-of-thoughts: branches self-score, the best is kept and the losers are pruned.
  - `graph` — graph-of-thoughts: branch, then merge the strongest ideas into one decision.
  - `hypothesis` — state competing hypotheses, seek discriminating evidence, eliminate the losers.
- **Steps & branches** — `--steps N` (1–20) caps the chain; `--branches N` (1–8) explores alternative paths tagged with a branch id (with scores under `tot`).
- **Adversarial critic** — `--critic <engine>` has a second engine attack the finished chain (the cross-engine check the single-model original can't do).
- **Tool-grounding** — thoughts that cite repo files which don't exist are flagged (`--no-ground` to disable), so a plan never hands `goal` phantom paths.
- **Machine-validated** — a `reflexion` chain that never actually critiques+revises is rejected by the `ThinkChain` machine.
- **Composes into other modes** — `agon goal --think` runs a decompose pass on the intent first (surfacing sub-problems + open questions, feeding a refined spec) so a long autonomous run never starts half-understood. Cesar reasons step-by-step before acting when `cesarThinkFirst` is enabled (`agon config set cesarThinkFirst true`).

### Nero
Adversarial self-challenge — Agon's answer to a devil's-advocate / evil-twin pass, but with a *real* second model instead of your own reasoning mirrored. Feed it a decision and its reasoning; a structurally adversarial critic attacks it with concrete failure scenarios (INVERSION / PRE-MORTEM / SECOND-ORDER), reports its own confidence the original is correct, and ends with a verdict: **FLAWED / PROCEED WITH CAUTION / SOUND**.

```bash
agon nero "Cache auth tokens in Redis with a 5-min TTL" --reasoning "Redis is shared across workers and fast"
agon nero "Ship the migration tonight" --confidence 80          # Nero reports its own % so you can compare
agon nero "Switch to event sourcing" --focus "replay + schema evolution"   # steer the critique
agon nero "..." --engine codex                                  # force a specific critic (skips rating selection)
agon nero "..." --json                                          # emit the NeroResult, pipe-friendly
```

- **The critic is the top-rated *adversary*, not the top-rated builder.** Selection uses the per-discipline **tribunal** Glicko rating (the closest proxy for "good at attacking"), falling back to the global rating, then to a random active engine when nothing has competed yet.
- **Never grades its own homework** — the author being challenged is excluded from the candidate pool, so in-session Cesar challenges are answered by a *different* engine whenever one is available.
- **For external CLIs too** — `agon nero` (and `agon call nero "<decision>" --jsonl`) is the mode Codex / Antigravity / Claude should reach for instead of an internal self-critique; it gives them a genuinely different model as the adversary.

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
Performs an automated, multi-engine code review of your uncommitted changes, branches, or commits — then folds every engine's findings into one **confidence-tiered consensus** instead of dumping several noisy reviews side by side. Each finding carries a 0–1 confidence, and a two-signal rule decides what truly blocks: one *blocking* finding at ≥0.85, **or** two engines flagging the same issue at ≥0.70 (a nit never blocks, even at 0.99). Findings are grouped **verified / needs-check / speculative / nit**; engine timeouts and parse-failures land in their own lane (never a phantom blocker); and medium-confidence findings can go to a **judge** for a second opinion.

```bash
/review HEAD~1..HEAD
agon review commit:HEAD --engines claude,codex,gemini
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
Autonomous, long-running orchestration. You hand Agon a finite, checkable task queue (e.g. a directory of gap specs) plus a green **gate** command, and it drives the whole queue to completion unattended — for hours. The value isn't "every engine succeeds"; it's the **gated competitive loop**: only clean, passing, test-witnessed patches ever land, even if half the panel times out or gets superseded.

**How it works — the per-task loop.** For each task, on a dedicated `goal/<id>` branch (never `main`):

1. **Worktree** — a fresh throwaway worktree is checked out at the base commit. *All engine activity — implement and review — runs inside this worktree; the repo you launched Agon from is never touched.* Any failure discards the worktree wholesale (atomic rollback).
2. **Implement** — forge races the engine roster in parallel. When you don't pin `--engines`, Cesar routes the roster per task (a single engine for a trivial gap, the full panel for a real feature) and escalates ambiguous/expensive tasks to the judge.
3. **Pick the winner** — *test-aware* selection: a passing patch that adds a test beats a higher-scoring one that doesn't (so the witness always has something to witness).
4. **Witness** — the new test must **fail on the base commit and pass on the new one** — no no-op tests.
5. **Mutation-witness** — canonical mutants on the changed lines must die, defeating tautological "encode the answer" tests (the highest-EV way to cheat a gate).
6. **Gate** — the frozen green oracle (your `--gate`) runs once from the worktree. It's snapshotted at start so a task can't weaken it.
7. **Review** — **all** review engines grade the diff in parallel; their findings are folded by a confidence-tiered **consensus** (verified / needs-check / speculative / nit) under a two-signal block rule. A **judge** adjudicates only the medium-confidence "needs-check" set. Flaky or empty engines land in a separate **failures lane** — they can't impersonate a blocker.
8. **Fix** — a verified blocker triggers one bounded fix pass, then re-gate + re-review.
9. **Commit** — only now does **one commit per task** land on the goal branch (CAS-safe). A task that can't pass **parks** with the reason and a saved gate log, and the run moves on.

The run is **journaled and resumable** (`--resume`), checkpoints cleanly on Ctrl-C, **meters real spend** (implement + the whole review panel + judge), and **never auto-pushes** by default — you review the commits and open the PR.

```bash
agon goal "Close all KERN gaps" \
  --queue .kern-gaps/ \
  --gate "npm run build && npm run typecheck && npm test" \
  --branch goal/close-gaps \
  --require-tests --max-attempts 3 \
  --max-hours 8 --budget 5 --push
```

**Flags / guardrails for a long run:**

| Flag | Purpose | Default |
| --- | --- | --- |
| `--queue` | Task source: a directory (one task/file) or a `.jsonl` of `{id,source,dependsOn}` | required |
| `--gate` | Green-oracle command — the authoritative pass/fail, frozen at start | required |
| `--branch` | Goal branch (`goal/<id>`) — **never `main`** | `goal/<id>` |
| `--engines` | Implementer roster; **authoritative** when set (no routing/narrowing) | all active |
| `--review-engines` / `--judge` | The review panel and the adjudicator | all / config→Cesar→first |
| `--require-tests` | Reject a source change with no test | on |
| `--max-attempts` | Attempts per task before park | `3` |
| `--max-hours` / `--budget` | Wall-clock and/or USD ceiling — either, both, or neither | off (`0`) |
| `--push` / `--pr` | Push the goal branch per task / open a PR at the end (never `main`) | off |
| `--resume` / `--status` / `--dry-run` | Resume from journal / print a run's digest / plan only | — |

Read a run's digest from any session with `agon goal --status --id close-all-kern-gaps`. Reachable from external CLIs via `agon call goal "<intent>" --queue <dir> --gate "<cmd>"`. _(Roadmap: hermetic gate isolation, detached delegation + async callback.)_

## Interactive REPL

Launching `agon` starts a powerful terminal REPL equipped with native scrollback, command history, and a file rail. 

Available commands include: `/forge`, `/synthesis`, `/brainstorm`, `/tribunal`, `/campfire`, `/pipeline`, `/review`, `/agent`, `/speculate`, `/team-forge`, `/status`, `/leaderboard`, `/history`, `/config`, `/plan`, `/models`, `/engines`, `/doctor`, `/help`, and `/exit`.

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

Agon can also be called from other AI CLIs such as Claude Code, Codex, and Gemini.

### One-step setup

Run this **once** to wire Agon into every AI CLI on your machine:

```bash
agon install-agent-prompts
```

It drops the native lightweight integration for each detected CLI:

| CLI | Installed files | Invoke |
| --- | --- | --- |
| Codex | `~/.codex/skills/agon/SKILL.md` and `~/.codex/skills/agon/agents/openai.yaml` | `$agon` in a new Codex session |
| Gemini CLI | `~/.gemini/commands/agon.toml` | `/agon` |
| Claude Code | `~/.claude/commands/agon.md` | `/agon` |

Each prompt or skill teaches the engine to call Agon from its own shell. No MCP, no always-on tokens: nothing runs until you invoke it. Target specific CLIs with `--cli codex,gemini,claude`, preview with `--dry`, or refresh an existing integration with `--force`.

After that, in Claude Code or Gemini:

```
/agon evolve this design doc into a concrete implementation plan
```

In Codex, start a new session so skills reload, then use:

```
$agon evolve this design doc into a concrete implementation plan
```

The engine runs `agon agent-guide` to learn the modes, then picks the right one — forge, synthesis, brainstorm, tribunal, campfire, review, or goal.

### Or call Agon directly

Any CLI that can run a shell command can call Agon straight away — no setup needed:

```bash
agon synthesis "Evolve this design doc into a concrete implementation plan" --swaps 2 --timeout 90
agon call tribunal "Should we ship this architecture?" --team --tribunalMode red-team
agon call brainstorm "How should we design the plugin API?" --team
agon call review
agon call forge "Implement the cache layer" --test "npm test" --team
agon call synthesis "Evolve this design doc into a concrete implementation plan" --swaps 2 --timeout 90
```

`agon call` streams the underlying Agon workflow into the caller's terminal, so the calling CLI can show live progress and the other engines' output. Use `--jsonl` when the caller wants machine-readable lifecycle events:

```bash
agon call tribunal "Debate the migration plan" --team --jsonl
```

### MCP (heavier alternative)

For MCP-capable clients, Agon also ships a stdio MCP server:

```bash
claude mcp add -s user agon -- node /path/to/Agon-AI/plugins/agon-orchestrator/scripts/agon-mcp.js
codex mcp add agon -- node /path/to/Agon-AI/plugins/agon-orchestrator/scripts/agon-mcp.js
```

After that, clients can call Agon tools such as Tribunal, Brainstorm, Forge, Campfire, Pipeline, and Review directly.

## Engines

Agon doesn't ship its own model — it **orchestrates the AI coding CLIs you already have**. The more engines you install and authenticate, the more competitors forge can race, the broader the review panel, and the better Cesar can route. To "get the most out of it," set up several.

### 1. Install the engine CLIs

Each engine is a separate CLI you install once. Built-ins (in `engines/*.json`):

| Engine | Install | Auth |
| --- | --- | --- |
| **Claude** (Anthropic) | `npm install -g @anthropic-ai/claude-code` | `claude` then `/login` (subscription) or `ANTHROPIC_API_KEY` |
| **Codex** (OpenAI) | `npm install -g @openai/codex` | `codex` then sign in, or `OPENAI_API_KEY` |
| **Gemini** (Google) | `npm install -g @google/gemini-cli` | `gemini` then sign in, or `GOOGLE_API_KEY` |
| **OpenCode** | `curl -fsSL https://opencode.ai/install \| bash` | `opencode auth login` (provider keys) |
| **Aider** | `pip install aider-chat` | provider API key |
| **Ollama** (local) | [ollama.com/download](https://ollama.com/download) | none (runs locally) |
| **OpenRouter** | `npm install -g openrouter-cli` | `OPENROUTER_API_KEY` |
| **Mistral** / **Qwen** | `pip install mistral-cli` / `qwen-cli` | provider API key |

Subscription/CLI-authed engines (Claude, Codex, Gemini, OpenCode) bill through their own login — no API key needed in your environment. The rest read an API key from the env var shown above.

### 2. Verify what Agon can see

`agon doctor` is the source of truth — it probes each engine's binary, auth, and capabilities:

```bash
agon doctor engines     # which engines are installed + reachable (binary/key/login)
agon doctor review      # smoke-test that each engine returns parseable review output
agon doctor harness     # Cesar routing: selected engine + tool reliability
```

Anything that shows `ok` is available to forge, review, and goal. Engines that fail are simply skipped (and quarantined in the review failures lane), so a missing CLI never breaks a run.

### 3. (Optional) Add API-based engines

Beyond the built-in CLIs, you can register any OpenAI- or Anthropic-compatible API endpoint — including provider "coding plans" — by dropping a JSON file in `~/.agon/engines/`. No code, no rebuild; Agon loads it on next launch.

```jsonc
// ~/.agon/engines/my-coding-plan.json
{
  "schemaVersion": 3,
  "id": "my-coding-plan",
  "displayName": "My Coding Plan",
  "isLocal": false,
  "tier": "user",
  "timeout": 180,
  "exec":   { "args": [] },
  "review": { "args": [] },
  "api": {
    "baseUrl": "https://api.example.com/v1",
    "apiKeyEnv": "MY_PLAN_API_KEY",   // read from this env var
    "model": "the-model-id",
    "maxTokens": 16384,
    "format": "anthropic"             // "anthropic" or "openai"
  }
}
```

Set the key (`export MY_PLAN_API_KEY=…`), then confirm with `agon doctor engines`. Built-in definitions live in the repo's `engines/` directory; your own go in `~/.agon/engines/` and override built-ins of the same id. Toggle availability and per-engine default models from there or via config (`engineModels`).

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
