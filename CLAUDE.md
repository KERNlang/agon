# Agon AI — Claude Code Instructions

## KERN-First Rule

**NEVER edit files in `packages/*/src/generated/` directly.** These are compiled output from KERN source files.

The source of truth is `packages/core/src/kern/*.kern`. The workflow is:

1. Edit the `.kern` file in `packages/core/src/kern/`
2. Run `cd packages/core && npm run kern:compile`
3. The compiler generates `packages/core/src/generated/*.ts`
4. If the KERN compiler has a bug (e.g., missing `*` for generators), fix the generated file AND file a note — but always update the `.kern` source first.

**Exception:** `packages/cli/src/` files (repl.ts, input-engine.ts, caesar.ts, onboarding.ts, output.ts) are hand-maintained TypeScript. They are NOT generated from KERN. The REPL layer stays TS — KERN doesn't have primitives for TTY interaction.

## Build & Test

```bash
npm run build          # tsc -b --force (all packages)
npm run test           # vitest run (all tests)
npm run typecheck      # tsc -b (type check only)
```

For core package specifically:
```bash
cd packages/core
npm run kern:compile   # Compile .kern → .ts
npm run build          # tsup bundle
```

## Architecture

- **packages/core** — Types, config, scoring, ELO, plan state machine, process spawner. KERN-sourced.
- **packages/forge** — Forge, brainstorm, tribunal, campfire orchestration. TypeScript (future KERN target).
- **packages/adapter-cli** — Engine adapter that dispatches to external CLIs. TypeScript (future KERN target).
- **packages/cli** — REPL, InputEngine, output, intent detection, Caesar local LLM. Hand-maintained TS.

## Conventions

- TypeScript monorepo with `verbatimModuleSyntax: true` — use `import type` for type-only imports
- ESM only (`"type": "module"`) — use `.js` extensions in imports
- All engine definitions are JSON files in `engines/*.json`
- Test pattern: `tests/unit/*.test.ts`, `tests/integration/*.test.ts`, `packages/*/src/**/*.test.ts`
- Vitest for testing, tsup for bundling, tsc for type checking

## Key Patterns

- `spawnWithTimeout(opts)` — spawns external process with timeout + abort signal
- `spawnStream(opts)` — async generator that yields stdout chunks
- `activeAbort: AbortController | null` — module-level abort for Ctrl+C cancellation
- All long-running handlers set `activeAbort` and pass `signal` through dispatch chain
- `startSpinner()` returns `{ update, stop }` — single-line animated indicator
- Per-engine animations use cursor-up rewrite pattern (`\x1b[NA` + `\x1b[2K`)
