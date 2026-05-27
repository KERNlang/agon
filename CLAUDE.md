# Agon AI — Claude Code Instructions

## ALL IN KERN — No Exceptions

**Every new function, type, constant, and handler MUST be written in KERN.** No hand-maintained TypeScript unless it's physically impossible (external library bindings like `@huggingface/transformers`, or hand-TS facades over generated DUs with function-typed fields).

The workflow:
1. Write `.kern` source in `packages/*/src/kern/<category>/` (surfaces, blocks, signals, models, or a feature domain like cesar/, tools/, handlers/)
2. Compile: `npm run kern:compile` (preferred) or `KERN_BIN=/abs/path/to/kern npm run kern:compile -w packages/<name>`
3. The hand-maintained `.ts` file becomes a thin re-export facade
4. If the type needs a discriminated union, use KERN's `union` node. If it needs a class, use `service`. If it needs async with abort, use `signal` + `cleanup`.
5. **NEVER write logic in TypeScript that KERN can express.** If you think KERN can't do it, check these primitives first:
   - `fn` — pure functions, `async=true` for async, `signal` + `cleanup` for AbortController
   - `service` — classes with methods, `implements`, `constructor`, `singleton`, `stream=true` for generators
   - `union` — discriminated unions with variants
   - `const` — constants including regex, arrays, records
   - `interface` — type definitions
   - `screen target=ink` — Ink/React components. **FULLY SUPPORTED** via `kern/packages/terminal/src/transpiler-ink.ts` (dispatched from `kern/packages/cli/src/shared.ts:465`). Agon already has 30+ ink screens (`surfaces/app.kern`, `surfaces/status.kern`, `blocks/arena.kern`, `blocks/composer.kern`, `blocks/rendering.kern`, etc.). Write new UI in `.kern`, not `.tsx`.

### What stays TypeScript (and why)
- `handlers/types.ts` — OutputEvent DU facade adding `Dispatch = (event: OutputEvent) => void` type alias (KERN `type` node can't generate function type aliases) and `readonly` on `currentPlan`. The union itself is generated from `handler-types.kern`.
- Thin facade files that re-export from `generated/` with tighter DU types.
- External library bindings where the JSX/API is dynamic enough that KERN's static surface can't help.

### NEVER edit `packages/*/src/generated/` directly
These are compiled output. Edit the `.kern` source, recompile.

## KERN Compiler

```bash
npm run kern:compile
```

Agon's compiler wrapper uses the root-installed `@kernlang/cli` family by default and validates the resolved `@kernlang/*` package family instead of trusting the CLI package alone.
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
- **packages/cli** — 60+ .kern files in `surfaces/`, `blocks/`, `signals/`, `models/`, `cesar/`, `handlers/`, `commands/`. **~99% KERN.** `app.tsx` is the last hand-TS file; it's a composition shell around generated screens and can be ported incrementally.
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

## Adding a New Mode — ALWAYS update these

When you add an agon mode/command (e.g. the `think` mode = sequential thinking, in `packages/forge/src/kern/thinking.kern` + `packages/cli/src/kern/commands/think.kern`; or the `nero` mode = adversarial self-challenge, in `packages/forge/src/kern/nero.kern` + `packages/cli/src/kern/commands/nero.kern`, where the critic is picked by the tribunal-discipline Glicko rating via `pickTopRatedEngine`), it is NOT done until every surface below is updated in the SAME change. Don't ship a mode that only `agon <mode>` knows about.

1. **Core/orchestration** — `packages/forge/src/kern/<mode>.kern` (the `run*` fn, takes `registry`+`adapter`), exported from `packages/forge/src/index.ts`.
2. **CLI command** — `packages/cli/src/kern/commands/<mode>.kern`, facade `packages/cli/src/commands/<mode>.ts`, registered in `packages/cli/src/index.ts` `subCommands`.
3. **External-CLI bridge** — add a branch in `packages/cli/src/commands/call.ts` (so `agon call <mode>` works) and a test in `tests/unit/call-command.test.ts`.
4. **Agent guide** (what `install-agent-prompts` ships to Codex/Antigravity/Claude) — `packages/cli/src/kern/commands/agent-guide.kern` (JSON `modes`) AND `agent-guide-text.kern` (prose + "Pick a mode").
5. **README.md** — the "You need… / Use / Why" table, the rule-of-thumb list, and a `### <Mode>` section with usage.
6. **This CLAUDE.md** and the **top-level `~/.claude/CLAUDE.md`** (the buddies→agon mapping) — so future sessions know the mode exists and how to call it.
7. **Tests** — `tests/unit/<mode>.test.ts` for the pure logic.

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

### KERN Ink Primitives (available in kern-lang ≥3.2.0 with `--target=ink`)
- `state name=x safe=false` — opt out of `__inkSafe` wrapper (default: safe, bridges microtask→macrotask)
- `state name=x throttle=90` — rate-limited setter
- `state name=x debounce=300` — debounced setter
- `ref name=bufferRef type="string[]" initial=null` — first-class useRef
- `animation name=frame interval=100 update="..."` — declarative setInterval with auto-cleanup
- `derive name=filtered expr={{ items.filter(...) }}` — auto-memoized useMemo
- `stream name=msgs source=session.messages mode=channel dispatch=handleChunk` — async generator → dispatch
- `on event=key key=return` — useInput with key matching
- `focus name=emailFocused autoFocus=true` — useFocus hook
- `app-exit on={{ complete }}` — clean exit via useApp
- `screen-embed screen=SpinnerBlock from="./status.kern"` — cross-file component imports
- `layout-row gap=2` / `layout-col` / `layout-stack padding=1` / `spacer` — semantic layout
- `screen name=X export=default` — export control (default vs named)
- Components: `multi-select`, `confirm-input`, `password-input`, `status-message`, `alert`, `ordered-list`, `unordered-list`, `newline`

### Known gaps (track what KERN can't express yet)
When you encounter a pattern KERN can't handle for Ink/React, add a `// KERN-GAP:` comment in the .kern file.

### Why this matters
Every workaround we write in TypeScript is a KERN feature request. The KERN compiler team uses these gaps to prioritize what to build next. Agon is the proving ground — if KERN can express Agon's entire CLI, it can express anything.
