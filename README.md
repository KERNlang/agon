# Agon

**AIs compete. The best code wins.**

Agon is a competitive AI orchestration framework. Give it a task and a test — it dispatches multiple AI engines in parallel, each working in an isolated git worktree, scores every solution, and applies the winner. ELO ratings track which engine performs best on which task over time.

---

## Quick Start

```bash
git clone https://github.com/KERNlang/agon.git
cd agon && npm install && npm run install:cli

agon                                              # launch interactive REPL
agon forge "add validation" --test "npm test"     # one-shot forge
```

---

## Core Modes

**Forge** — AI engines race on the same task. Each works in its own git worktree. Agon scores every solution and applies the winner.

```bash
agon forge "implement rate limiting" --test "npm test"
```

**Brainstorm** — Engines bid for confidence on how to tackle a problem. Higher confidence means more tokens allocated.

```bash
agon brainstorm "best caching strategy?"
```

**Tribunal** — Engines debate a proposed solution, argue its flaws, and reach consensus.

```bash
agon tribunal "should we switch to PostgreSQL?"
```

**Campfire** — A relaxed, open-ended discussion where engines share perspectives without a competitive goal.

```bash
agon campfire "lessons from our last outage"
```

**Pipeline** — A focused build-review-fix loop for one task when competition is unnecessary.

```bash
agon pipeline "tighten form validation" --test "npm test"
```

---

## Cesar

Cesar is the orchestrator that routes tasks to engines. By default, it picks the best-rated engine for your task based on ELO history. You can override this with the `--engine` flag:

```bash
agon forge "fix auth bug" --engine claude
```

Available engines: `claude`, `codex`, `gemini`, `aider`, `ollama`, `mistral`, `opencode`, `openrouter`, `qwen`

Configure which engines are available by editing `~/.agon/AGON.md`.

---

## Requirements

- **Node.js >= 22**
- **Git repo** — Agon uses git worktrees to isolate engine environments
- **At least one AI CLI** — e.g., Claude (`npm install -g @anthropic-ai/claude-code`), Codex, or any engine listed above

---

## Source Install

```bash
git clone https://github.com/KERNlang/agon.git
cd agon
npm install
npm run install:cli
```

This installs the CLI globally as `agon`. Run `agon` to start the REPL.

---

MIT — https://github.com/KERNlang/agon
