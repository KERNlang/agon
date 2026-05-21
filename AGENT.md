# Agon AI — Agent Instructions

> Any AI can join. They compete. You ship.

Agon is a multi-AI orchestration framework. Engines (Claude, Codex, Gemini, MiniMax, Qwen, etc.) compete via forge, debate via tribunal, ideate via brainstorm. Cesar orchestrates — delegates based on confidence, ELO ratings, and task classification.

## Using Agon From Codex

Codex agents should use Agon when the task benefits from multiple engines, adversarial review, team competition, or confidence-weighted ideation, but interactive chat must never auto-start these modes just because the user mentions "brainstorm", "tribunal", "forge", or "review". In the Agon UI, orchestration starts only from explicit slash commands (`/brainstorm`, `/tribunal`, `/forge`, `/review`, etc.) or from explicit CLI/MCP calls. If the user is speaking normally, suggest the slash command instead of starting the workflow.

For non-interactive Codex shell work, the fastest path is the shell bridge:

```bash
agon call brainstorm "What approaches should we consider for this migration?"
agon call tribunal "Should we ship this architecture?" --tribunalMode red-team --rounds 2
agon call forge "Implement the cache layer" --test "npm test"
agon call synthesis "Evolve this design doc into a concrete implementation plan" --swaps 2 --timeout 90
agon call review
```

If `agon` is not linked in the shell, build/link it first:

```bash
npm run build
npm run install:cli
```

Machine-readable callers should add `--jsonl`:

```bash
agon call brainstorm "Compare options for this refactor" --jsonl
```

Use `--cwd <path>` when the target repository is not the current working directory. Use `--engines claude,codex,gemini` to pin participants when needed. Use `--timeout <seconds>` for long-running tasks.

External engines should always call Agon through the shell bridge, not direct model CLIs:

```bash
agon call <workflow> "<input>" [flags]
```

Example workflows: `forge`, `brainstorm`, `synthesis`, `tribunal`, `campfire`, `pipeline`, `review`, `goal`, and `team-*`.

Do not use `qwen`, `opencode`/Kimi, or `ollama` for Agon orchestration unless the user explicitly asks for one of them. Prefer known-good local engines such as `claude`, `codex`, and `gemini` when pinning engines.

### Agon Mode Guide

- `brainstorm`: use for open-ended approaches, architecture options, migration strategy, naming/API design, and "what are we missing?" questions.
- `team-brainstorm`: use when idea quality matters enough to have teams synthesize and compete. Good for major product/architecture direction.
- `tribunal`: use for tradeoffs, risky decisions, disagreement, review of a proposed plan, or "argue both sides."
- `team-tribunal`: use when debate quality matters; teams argue positions and a judge synthesizes.
- `forge`: use when multiple engines should implement the same bounded coding task and compete under a fitness command.
- `team-forge`: use for high-value implementation where teams of engines collaborate and compete.
- `synthesis`: use for cross-pollination where engines iteratively improve each other's drafts and a judge selects the best evolved result.
- `campfire`: use when the problem is fuzzy and needs exploratory discussion before a crisp plan exists.
- `pipeline`: full sequence: brainstorm, forge, then tribunal review. Use for critical changes where design, implementation, and review all matter.
- `review`: use for code review of uncommitted changes or a specified target.
- `agent` / `delegate`: use from the interactive app or MCP tools for bounded specialist help, not full competition.
- `QuickNero`: use from MCP/Cesar flows for a fast self-challenge before escalating to heavier modes.
- `plan`: use when the workflow needs staged execution, resumability, approval, or cost visibility.

### Team Modes

Team modes are available through both direct commands and `agon call`:

```bash
agon call brainstorm "Design plugin loading" --team --members 2
agon call team-brainstorm "Design plugin loading" --members 3
agon call forge "Implement session persistence" --team --members 2 --test "npm test"
agon call team-forge "Implement session persistence" --members 3 --test "npm test"
agon call tribunal "Pick the safer rollout plan" --team --members 2 --tribunalMode adversarial
agon call team-tribunal "Pick the safer rollout plan" --members 3 --tribunalMode red-team
```

Interactive equivalents:

```text
/team-brainstorm 2v2 <question>
/team-tribunal 3v3 red-team <question>
/team-forge 2v2 <task> test with <command>
```

### Tribunal And Campfire Options

Tribunal modes:

```bash
agon call tribunal "Question" --tribunalMode adversarial
agon call tribunal "Question" --tribunalMode synthesis
agon call tribunal "Question" --tribunalMode steelman
agon call tribunal "Question" --tribunalMode socratic
agon call tribunal "Question" --tribunalMode red-team
agon call tribunal "Question" --tribunalMode postmortem
```

Campfire strategies:

```bash
agon call campfire "Explore the failure modes" --strategy all-respond
agon call campfire "Explore the failure modes" --strategy lead-first --lead claude
```

### MCP For Codex

Codex can use Agon through MCP instead of shell commands:

```bash
codex mcp add agon -- node /path/to/Agon-AI/plugins/agon-orchestrator/scripts/agon-mcp.js
```

Available MCP orchestration tools include `Brainstorm`, `Tribunal`, `Campfire`, `Forge`, `Pipeline`, `Review`, `Agent`, `Delegate`, `QuickNero`, `ReportConfidence`, and `ProposePlan`. When using MCP, call the matching Agon tool directly instead of spawning `agon call`. After starting an orchestration tool other than `Delegate`, `QuickNero`, or `ReportConfidence`, stop and wait for the result.

### Choosing The Right Mode

- If confidence is high and the change is small, stay local and implement.
- If confidence is medium and the question is open, use `brainstorm`.
- If confidence is medium and the issue is a tradeoff, use `tribunal`.
- If confidence is low because the problem is unclear, use `campfire`.
- If implementation quality matters and a fitness command exists, use `forge`.
- If the change is high-impact, use `pipeline` or `team-forge`.
- If the user explicitly asks for teams, competition, "multiple AIs", or "best result", prefer team modes or forge.

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
- Agon validates the resolved `@kernlang/*` package family and rejects stale installs instead of trusting the CLI package alone.

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
npm run kern:test      # Kern runtime tests
npm run typecheck      # tsc -b
npm run build          # build CLI and types
npm test               # Kern tests + vitest
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
