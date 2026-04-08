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
