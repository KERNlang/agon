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
