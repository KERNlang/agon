# Agon AI — Claude Code Instructions

## ALL IN KERN — No Exceptions

**Every new function, type, constant, and handler MUST be written in KERN.** No hand-maintained TypeScript unless it's physically impossible (React/Ink JSX until `--target=ink` ships, or external library bindings like `@huggingface/transformers`).

The workflow:
1. Write `.kern` source in `packages/*/src/kern/`
2. Compile: `node /Users/nicolascukas/GitHub/kern-lang/packages/cli/dist/cli.js compile <file.kern> --outdir=<package>/src/generated`
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

## KERN Compiler Location

```
/Users/nicolascukas/GitHub/kern-lang/packages/cli/dist/cli.js
```

Compile core nodes: `node $KERN compile <file.kern> --outdir=<dir>`
Available primitives: `fn`, `service`, `union`, `interface`, `const`, `import`, `machine`, `event`, `screen`

## Build & Test

```bash
npm run build          # tsc -b --force (all packages)
npm run test           # vitest run (all tests)
npm run typecheck      # tsc -b (type check only)
```

## Architecture — KERN Coverage

- **packages/core** — 20 .kern files. **100% KERN.** Types, config, scoring, ELO, plan state machine, process spawner, EngineRegistry (`service`), TokenTracker (`service` + `singleton`).
- **packages/forge** — 9 .kern files. **100% KERN.** Forge, brainstorm, tribunal, campfire orchestration.
- **packages/adapter-cli** — 2 .kern files. **100% KERN.** CliAdapter (`service implements EngineAdapter`).
- **packages/cli** — 16 .kern files. **~95% KERN.** All handlers, intent detection, output helpers, markdown parser. Remaining: `app.tsx` (Ink target pending).

## Conventions

- ESM only (`"type": "module"`) — use `.js` extensions in imports
- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- Engine definitions: `engines/*.json`
- Tests: `tests/unit/*.test.ts`, `tests/integration/*.test.ts`
- Vitest for testing, tsc for type checking

## Key Patterns

- `spawnWithTimeout(opts)` — spawns external process with timeout + abort signal (KERN: `process.kern`)
- `spawnStream(opts)` — async generator yielding stdout chunks (KERN: `process.kern`)
- `signal` + `cleanup` on KERN `fn` — generates AbortController + try/finally
- `service` with `stream=true` method — generates `async *method(): AsyncGenerator<T>`
- All handlers use `signal name=abort` for cancellation support
