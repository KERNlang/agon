# Agon AI — Agent Instructions

## What is Agon?

"Any AI can join. They compete. You ship."

Agon is a competitive AI orchestration framework. Multiple AI engines (Claude, Codex, Gemini, Ollama, etc.) race to solve tasks. Engines are scored on correctness, quality, diff size, focus, speed. ELO tracks performance over time.

## KERN-First Development

This project uses [KERNlang](https://github.com/cukas/KERNlang) as the source of truth for core types and logic.

**Rule:** All changes to `packages/core` MUST go through `.kern` files first:
```
packages/core/src/kern/*.kern  →  kern:compile  →  packages/core/src/generated/*.ts
```

Never edit `generated/` files directly. If the KERN compiler can't express something, use the `handler <<<...>>>` escape hatch in the `.kern` file.

**Exception:** CLI layer (`packages/cli/src/`) is hand-maintained TypeScript.

## Monorepo Structure

```
packages/
  core/          — KERN-sourced types, config, scoring, ELO, plans, process
  forge/         — Forge, brainstorm, tribunal, campfire orchestration
  adapter-cli/   — Shell exec adapter for external AI CLIs
  cli/           — REPL, InputEngine, Caesar local LLM, output rendering
engines/         — JSON engine definitions (claude.json, codex.json, etc.)
tests/           — Unit + integration tests (vitest)
```

## Key Commands

```bash
npm run build        # Build all packages
npm run test         # Run 120+ tests
npm run typecheck    # Type check all packages
cd packages/core && npm run kern:compile  # Recompile KERN
```

## Dispatch Chain

```
User input → InputEngine → detectIntent() → handler
  → adapter.dispatch({ engine, prompt, signal })
    → spawnWithTimeout({ command, args, signal })
      → child process (claude/codex/gemini CLI)
```

All handlers support `AbortSignal` for Ctrl+C cancellation.

## Adding a New Engine

1. Create `engines/<name>.json` with the engine definition schema
2. The engine is auto-discovered via `EngineRegistry.load()`
3. No code changes needed — the adapter resolves commands from the JSON definition
