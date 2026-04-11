# Agon AI — Claude Code Instructions

## ALL IN KERN — No Exceptions

**Every new function, type, constant, and handler MUST be written in KERN.** No hand-maintained TypeScript unless it's physically impossible (React/Ink JSX until `--target=ink` ships, or external library bindings like `@huggingface/transformers`).

The workflow:
1. Write `.kern` source in `packages/*/src/kern/<category>/` (surfaces, blocks, signals, models, or a feature domain like cesar/, tools/, handlers/)
2. Compile: `npx kern compile src/kern/<category> --outdir=src/generated/<category>` (or use `npm run kern:compile`)
3. The hand-maintained `.ts` file becomes a thin re-export facade
4. If the type needs a discriminated union, use KERN's `union` node. If it needs a class, use `service`. If it needs async with abort, use `signal` + `cleanup`.
5. **NEVER write logic in TypeScript that KERN can express.** If you think KERN can't do it, check these primitives first:
   - `fn` — pure functions, `async=true` for async, `signal` + `cleanup` for AbortController
   - `service` — classes with methods, `implements`, `constructor`, `singleton`, `stream=true` for generators
   - `union` — discriminated unions with variants
   - `const` — constants including regex, arrays, records
   - `interface` — type definitions
   - `screen target=ink` — Ink/React components (pending `--target=ink` CLI integration)

### What stays TypeScript (and why)
- `app.tsx` — React/Ink REPL with JSX, hooks, state. Blocked on `--target=ink` in kern-lang CLI.
- `handlers/types.ts` — OutputEvent DU with function-typed fields (`resolve: (answer: string) => void`).
- Thin facade files that re-export from `generated/` with tighter DU types.

### NEVER edit `packages/*/src/generated/` directly
These are compiled output. Edit the `.kern` source, recompile.

## KERN Compiler

```bash
npx kern compile src/kern/<category> --outdir=src/generated/<category>
# Or compile all at once:
npm run kern:compile
```

Installed via `kern-lang` npm package (^3.1.7). Available in all packages via `node_modules/.bin/kern`.
Available primitives: `fn`, `service`, `union`, `interface`, `const`, `import`, `machine`, `event`, `screen`

**KERN MCP**: Add `https://kernlang.dev/api/mcp` to your `.mcp.json`. Provides compile, validate, review, schema, and 11 tools total — including autonomous compile→fix loops. See `.mcp.json.example` in this repo.

## Build & Test

```bash
npm run build          # tsc -b --force (all packages)
npm run test           # vitest run (all tests)
npm run typecheck      # tsc -b (type check only)
```

## Architecture — KERN Coverage

- **packages/core** — 69 .kern files in `models/`, `signals/`, `blocks/`, `cesar/`, `tools/`, `api/`, `sessions/`, `teams/`. **100% KERN.**
- **packages/cli** — 60 .kern files in `surfaces/`, `blocks/`, `signals/`, `models/`, `cesar/`, `handlers/`, `commands/`. **~95% KERN.** Remaining: `app.tsx` (Ink target pending).
- **packages/forge** — 17 .kern files. **100% KERN.** Forge, brainstorm, tribunal, campfire orchestration.
- **packages/adapter-cli** — 2 .kern files. **100% KERN.** CliAdapter (`service implements EngineAdapter`).

### KERN Directory Pattern
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

## Key Patterns

- `spawnWithTimeout(opts)` — spawns external process with timeout + abort signal (KERN: `blocks/process.kern`)
- `spawnStream(opts)` — async generator yielding stdout chunks (KERN: `blocks/process.kern`)
- `signal` + `cleanup` on KERN `fn` — generates AbortController + try/finally
- `service` with `stream=true` method — generates `async *method(): AsyncGenerator<T>`
- All handlers use `signal name=abort` for cancellation support

## KERN Ink Gaps — Report Missing Primitives

Agon AI is a primary testbed for KERN's Ink support. When you hit a limitation where KERN can't express something cleanly for Ink/React, **report it** — don't silently work around it in TypeScript.

### How to report
Add a comment in the `.kern` file where the gap was hit:
```
// KERN-GAP: <category> — <description of what's needed>
```

### Known gaps (pending KERN compiler improvements)
- **async-safe-setter** — React state setters called from async/Promise context don't trigger Ink repaints. KERN needs a primitive that wraps setters to bridge microtask→macrotask automatically.
- **throttle/debounce on state** — `state name=x throttle=90` instead of hand-rolling setTimeout timer logic in useMemo closures.
- **ref as first-class node** — `ref name=bufferRef type="T" initial=null` instead of declaring refs inside handler blocks.
- **Ink-aware dispatch** — KERN-generated dispatch functions should handle microtask→macrotask bridging automatically so Ink always repaints.
- **animation primitive** — declarative interval-driven state updates (what SpinnerBlock does manually with setInterval/setNow).
- **channel/stream primitive** — for async generators flowing into React state (the `session.send()` → UI pattern).
- **screen composability** — screen nodes embedding other screen nodes with typed props, not raw JSX.
- **layout node** — KERN-native Ink Box/flex configuration instead of hand-writing `<Box flexDirection="column">` in JSX.

### Why this matters
Every workaround we write in TypeScript is a KERN feature request. The KERN compiler team uses these gaps to prioritize what to build next. Agon is the proving ground — if KERN can express Agon's entire CLI, it can express anything.
