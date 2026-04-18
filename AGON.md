# AGON.md -- Agon AI

Multi-AI orchestration. Engines compete (forge), debate (tribunal), ideate (brainstorm). Cesar orchestrates. Global: `~/.agon/AGON.md`

## ALL IN KERN

Every new function, type, constant, handler MUST be in KERN. No hand-maintained TS unless impossible.

1. Write `.kern` in `packages/*/src/kern/<category>/`
2. `npm run kern:compile`
3. `.ts` facade re-exports from `generated/`
4. NEVER edit `packages/*/src/generated/` directly

Primitives: fn, service, union, const, interface, screen(ink), import, machine, event

## Architecture

packages/core -- 69 .kern. Types, config, scoring, tools, sessions. 100% KERN.
packages/cli -- 60+ .kern. Surfaces, blocks, signals, handlers, commands. ~99% KERN.
packages/forge -- 17 .kern. Forge, brainstorm, tribunal, campfire. 100% KERN.
packages/adapter-cli -- 2 .kern. CliAdapter. 100% KERN.
engines/ -- JSON engine definitions (claude.json, codex.json, gemini.json, etc.)

Dirs: surfaces/ blocks/ signals/ models/ cesar/ tools/ handlers/ commands/

## Build & Test

npm run kern:compile   # Compile KERN
npm run build          # tsc -b --force
npm run test           # vitest run
npm run typecheck      # tsc -b

## Conventions

- ESM only, .js extensions in imports
- verbatimModuleSyntax: import type for type-only
- Vitest testing, tsc type checking
- Engine defs: engines/*.json

## Error Handling Philosophy

- Silent `catch {}` is **intentional** for: feature detection (file probes), optional metadata reads (package.json, Cargo.toml), best-effort cleanup (unlinkSync temp files), JSON parse fallbacks
- **Do log** (`console.warn`) for: session close failures, process kill failures, state persistence errors — anything where silent failure could corrupt state or leak resources
- Pattern: `console.warn(\`[agon] context: \${e instanceof Error ? e.message : String(e)}\`)`

## Known State

- All listed bugs in task-a-bugs.md have been verified as already fixed
- The generated/ catch blocks are intentionally silent — do not flag as issues

## Error Handling Philosophy

- Silent `catch {}` is **intentional** for: feature detection (file probes), optional metadata reads (package.json, Cargo.toml), best-effort cleanup (unlinkSync temp files), JSON parse fallbacks
- **Do log** (`console.warn`) for: session close failures, process kill failures, state persistence errors — anything where silent failure could corrupt state or leak resources
- Pattern: `console.warn(\`[agon] context: \${e instanceof Error ? e.message : String(e)}\`)`

## Known State

- All listed bugs in task-a-bugs.md have been verified as already fixed
- The generated/ catch blocks are intentionally silent — do not flag as issues
