# Agon AI — Agent Instructions

> Any AI can join. They compete. You ship.

Agon is a multi-AI orchestration framework. Engines (Claude, Codex, Gemini, MiniMax, Qwen, etc.) compete via forge, debate via tribunal, ideate via brainstorm. Cesar orchestrates — delegates based on confidence, ELO ratings, and task classification.

## Confidence First

When answering, always state confidence clearly enough that the user can tell whether the claim is certain, likely, or tentative.
- Do this for diagnoses, implementation claims, verification results, and recommendations.
- If confidence is low or mixed, say why.
- Do not hide uncertainty behind confident wording.

## ALL IN KERN — No Exceptions

Every new function, type, constant, and handler MUST be written in KERN. No hand-maintained TypeScript unless physically impossible (React/Ink JSX, external library bindings).

Workflow:
1. Write `.kern` source in `packages/*/src/kern/<category>/`
2. Compile: `npm run kern:compile`
3. The `.ts` facade re-exports from `generated/`

Compiler resolution:
- `npm run kern:compile` uses the root-installed `@kernlang/*` family pinned in `package.json`.
- Set `KERN_BIN=/abs/path/to/kern` to override the compiler explicitly for one top-level command.
- `npm run kern:compile:local` and `npm run build:cli:local` opt into a sibling `../kern-lang` checkout.
- Agon validates the compiler's effective `KERN_VERSION` and rejects stale installs instead of trusting package metadata alone.

CLI runtime note:
- For changes under `packages/cli/src/kern/`, `npm run kern:compile -w packages/cli` only updates `packages/cli/src/generated/`.
- The actual `agon` binary runs from `packages/cli/dist/index.js`, so rebuild it with `npm run build -w packages/cli` before verifying runtime behavior.
- A running `agon` session will not hot-reload compiled KERN changes. Restart the process after rebuilding.

**NEVER edit `packages/*/src/generated/` directly.** These are compiled output.

### KERN Primitives
- `fn` — functions (`async=true`, `signal` + `cleanup` for AbortController)
- `service` — classes with methods, `implements`, `constructor`, `singleton`, `stream=true`
- `union` — discriminated unions with variants
- `const` — constants (regex, arrays, records)
- `interface` — type definitions
- `screen target=ink` — React/Ink components
- `import` — ESM imports
- `machine` — state machines
- `event` — event definitions

### KERN MCP
Add `https://kernlang.dev/api/mcp` to your MCP config for compile, validate, review, schema, and 8 more tools. See `.mcp.json.example`.

## Build & Test

```bash
npm run kern:compile   # Compile all KERN sources
npm run build          # tsc -b --force (all packages)
npm run test           # vitest run (809 tests)
npm run typecheck      # tsc -b (type check only)
```

## Architecture

```
packages/
  core/          — 69 .kern files. Types, config, scoring, tools, sessions, API. 100% KERN.
  cli/           — 60 .kern files. Surfaces, blocks, signals, handlers, commands. ~95% KERN.
  forge/         — 17 .kern files. Forge, brainstorm, tribunal, campfire. 100% KERN.
  adapter-cli/   — 2 .kern files. CliAdapter (service implements EngineAdapter). 100% KERN.
engines/         — JSON engine definitions (claude.json, codex.json, etc.)
tests/           — Unit + integration tests (vitest)
```

### Directory Pattern
- `surfaces/` — top-level screens (what the user sees)
- `blocks/` — reusable UI/logic components
- `signals/` — state, dispatch, routing, config, registries, stores
- `models/` — types, interfaces, schemas
- Feature domains: `cesar/`, `tools/`, `api/`, `sessions/`, `teams/`, `handlers/`, `commands/`

## Conventions

- ESM only (`"type": "module"`) — use `.js` extensions in imports
- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- Engine definitions: `engines/*.json`
- Tests: `tests/unit/*.test.ts`, `tests/integration/*.test.ts`
- Vitest for testing, tsc for type checking

## Dispatch Chain

```
User input → Cesar (orchestrator) → confidence check → delegate or respond
  delegate → adapter.dispatch({ engine, prompt, mode, timeout, signal })
    → companion protocol (JSONRPC/ACP/stream-json) or CLI spawn or API fallback
```

All handlers support `AbortSignal` for cancellation.

## Key Patterns

- `spawnWithTimeout(opts)` — external process with timeout + abort (KERN: `blocks/process.kern`)
- `spawnStream(opts)` — async generator yielding stdout chunks
- `signal` + `cleanup` on `fn` — generates AbortController + try/finally
- `service` with `stream=true` method — generates `async *method(): AsyncGenerator<T>`
- `companionDispatch` — JSONRPC (Codex), ACP (Gemini/OpenCode), stream-json (Claude)

## Adding a New Engine

1. Create `engines/<name>.json` with the engine definition schema
2. The engine is auto-discovered via `EngineRegistry.load()`
3. No code changes needed — the adapter resolves commands from the JSON definition
