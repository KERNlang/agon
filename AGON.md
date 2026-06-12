# AGON.md -- Agon AI

Multi-AI orchestration. Engines compete (forge), debate (tribunal), ideate (brainstorm). Cesar orchestrates. Global: `~/.agon/AGON.md`

## ALL IN KERN

Every new function, type, constant, handler MUST be in KERN. No hand-maintained TS unless impossible.

1. Write `.kern` in `packages/*/src/kern/<category>/`
2. `npm run kern:compile`
3. `.ts` facade re-exports from `generated/`
4. NEVER edit `packages/*/src/generated/` directly

Primitives: fn, service, union, const, interface, screen(ink), import, machine, event

## Scrollback Architecture

Agon runs in the **terminal's main buffer** (no alt-screen). Past transcript rows commit to Ink's `<Static>` → flow into native scrollback. Mouse wheel scrolls the terminal natively; plain-drag + Cmd+C selects and copies.

- `<Static items={displayRows}>` owns committed history
- Dynamic region renders below Static (live streaming, file rail, composer, status)
- No `<AlternateScreen>`, no `<ScrollBox>`, no mouse tracking (SGR 1000/1002/1006 never emitted)
- `patches/ink+5.2.1.patch` removes Ink's `outputHeight >= stdout.rows → clearTerminal` branch so scrollback is preserved when output fills the viewport
- Bracketed paste (`ESC[?2004h/l`) is the only raw escape written from app.kern
- File rail: Ctrl+B toggles. When rail open + composer empty: ↑/↓ select, →/← expand/collapse, Esc closes
- Ctrl+G toggles "selection mode" state — vestigial from alt-screen days; no longer changes mouse tracking since terminal always owns the mouse

## Architecture

packages/core -- 69 .kern. Types, config, scoring, tools, sessions. 100% KERN.
packages/cli -- 60+ .kern. Surfaces, blocks, signals, handlers, commands. ~99% KERN.
packages/forge -- 17 .kern. Forge, brainstorm, tribunal, campfire. 100% KERN.
packages/adapter-cli -- 2 .kern. CliAdapter. 100% KERN.
engines/ -- JSON engine definitions (claude.json, codex.json, agy.json, etc.)

Dirs: surfaces/ blocks/ signals/ models/ cesar/ tools/ handlers/ commands/

## Build & Test

npm run kern:compile   # Compile KERN
npm run build          # tsc -b --force
npm run test           # vitest run
npm run typecheck      # tsc -b

## Git Workflow — NEVER commit/push to main

- NEVER commit or push directly to `main`/`master`. Always: feature branch → push → open PR. This applies to **Cesar/builder auto-commits too** — an autonomous build leaves work for a human merge gate; it does not land on main.
- Stage explicit paths; never `git add -A` in the shared working tree (it sweeps other sessions' WIP).
- Run the gate (`npm run kern:compile && npm run test`) green before committing; "done" from a builder is unverified until the gate passes.

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

## RAG Roadmap

v0 (shipped): docs-only corpus (root `*.md` + `docs/`) → markdown-aware chunking → offline MiniLM embeddings (`@kernlang/agon-dedup` embedder.py sidecar, cache `~/.agon/cache/fastembed`) → persistent index `.agon/rag/<corpus-hash>/` → `agon rag index|query|stats` + the `ProjectContext` MCP tool (fail-closed grounding, cited `[n] source Lx-y` blocks).

v0.1 (shipped): **`agon --ground` Cesar wire-up** — opt-in (`--ground` flag or `agon config set cesarGround true`); narrow trigger (skips slash commands + short inputs), retrieves cited doc context per turn and injects it as evidence ahead of the prompt. Fail-OPEN by design: no corpus / no embedder / weak hits → nothing injected, routing never gated on retrieval. Plus **`docs/modes.md`**: the mode catalog (incl. the nero→tribunal→council→conquer escalation ladder) generated from the canonical agent guide (`npm run docs:modes`, drift-guarded by a unit test) so RAG answers "which mode when" with citations — per the 6-engine `cesar-mode-rag` brainstorm verdict (the catalog stays statically injected for routing; RAG carries docs now, experience later).

Deferred, in priority order — each reuses the v0 retriever/embed primitives:

1. **Session-history corpus** — needs turn-indexed chunking + a redaction story for secrets in transcripts.
1b. **Run-history "mode experience" corpus** (from the `cesar-mode-rag` brainstorm) — one summarized routing episode per chunk (task shape, mode chosen, alternatives, outcome, lesson) derived from `~/.agon/runs/*/status.json`; advisory-only precedent briefs for Cesar's mode suggestion, gated on min-N (≥3) + similarity thresholds with recency/era weighting; hard-filter aborted/short runs and incompatible router eras. Build only after `--ground` proves stable in use.
2. **Code/diff corpus for `agon review`** — AST-aware chunker, commit-SHA provenance.
3. **Network-exposed ProjectContext** for companion CLIs beyond the local MCP server (schema-version pin).
4. **Live/incremental reindexing** (file watcher) — v0 reindex is manual and corpus-hash short-circuited.
5. **Hybrid search (BM25 + vector)** — swap-in retriever variant, same contract.
6. **Multi-repo corpus federation** — own design doc.
7. **Citation UX beyond plain text** — collapsible file-rail panel integration.
