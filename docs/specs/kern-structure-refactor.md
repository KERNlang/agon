# Spec: KERN-Native Project Structure Refactor

## Goal

Reorganize AGON's 149 .kern files from flat prefix-naming (`cesar-brain.kern`, `ui-app.kern`) into KERN's native `surfaces/blocks/signals/models` pattern with a `cesar/` feature domain. This makes the codebase navigable for both humans and LLMs, and dogfoods KERN's own structure conventions.

## Current State

```
packages/cli/src/kern/           # 30+ files, flat, prefix-named
├── cesar-brain.kern
├── cesar-confidence.kern
├── cesar-escalation.kern
├── cesar-routing.kern
├── cesar-session.kern
├── cesar-suggestion.kern
├── cesar-tools.kern
├── handlers-brainstorm.kern
├── handlers-build.kern
├── handlers-campfire.kern
├── handlers-cesar-brain.kern
├── handlers-commit.kern
├── handlers-cp.kern
├── handlers-forge.kern
├── handlers-info.kern
├── handlers-plan-mode.kern
├── handlers-run.kern
├── handlers-team-brainstorm.kern
├── handlers-team-forge.kern
├── handlers-team-tribunal.kern
├── handlers-tribunal.kern
├── ui-app.kern
├── ui-controls.kern
├── ui-engine.kern
├── ui-onboarding.kern
├── ui-rendering.kern
├── ui-status.kern
├── app-dispatch.kern
├── app-output.kern
├── app-review.kern
├── intent.kern
├── intent-types.kern
├── ghost-text.kern
├── handler-types.kern
├── markdown.kern
└── ansi-parse.kern

packages/core/src/kern/          # 20+ files, flat
├── config.kern
├── tool-types.kern
├── tool-registry.kern
├── tool-orchestration.kern
├── engine-registry.kern
├── engine-discover.kern
├── engine-memory.kern
├── elo.kern
├── process.kern
├── hooks.kern
├── skill-loader.kern
├── context-scanner.kern
├── extension-manifest.kern
├── extension-loader.kern
├── command-registry.kern
├── event-bus.kern
├── builtin-commands.kern
├── cesar-plan.kern
├── cesar-plan-formatter.kern
├── cesar-memory.kern
├── errors.kern
├── chat-store.kern
├── clipboard.kern
├── flow.kern
├── git.kern
├── sidechain-logger.kern
└── ...more
```

## Target Structure

Using KERN's native pattern (`surfaces/blocks/signals/models`) + feature domains:

### packages/cli/src/kern/

```
surfaces/                    # Top-level screens (what the user sees)
├── app.kern                     ← ui-app.kern
├── onboarding.kern              ← ui-onboarding.kern
└── status.kern                  ← ui-status.kern

blocks/                      # Reusable UI components
├── engine.kern                  ← ui-engine.kern
├── controls.kern                ← ui-controls.kern
├── rendering.kern               ← ui-rendering.kern
├── review.kern                  ← app-review.kern
└── markdown.kern                ← markdown.kern

signals/                     # State, dispatch, routing, event handling
├── dispatch.kern                ← app-dispatch.kern
├── output.kern                  ← app-output.kern
├── intent.kern                  ← intent.kern
├── intent-types.kern            ← intent-types.kern
├── ghost-text.kern              ← ghost-text.kern
└── ansi-parse.kern              ← ansi-parse.kern

models/                      # Types, interfaces
└── handler-types.kern           ← handler-types.kern

cesar/                       # Orchestrator domain (feature folder)
├── brain.kern                   ← handlers-cesar-brain.kern
├── confidence.kern              ← cesar-confidence.kern
├── escalation.kern              ← cesar-escalation.kern
├── routing.kern                 ← cesar-routing.kern
├── session.kern                 ← cesar-session.kern
├── suggestion.kern              ← cesar-suggestion.kern
└── tools.kern                   ← cesar-tools.kern

handlers/                    # Command handlers (one per slash command)
├── forge.kern                   ← handlers-forge.kern
├── brainstorm.kern              ← handlers-brainstorm.kern
├── tribunal.kern                ← handlers-tribunal.kern
├── campfire.kern                ← handlers-campfire.kern (if exists)
├── build.kern                   ← handlers-build.kern
├── commit.kern                  ← handlers-commit.kern
├── cp.kern                      ← handlers-cp.kern
├── info.kern                    ← handlers-info.kern
├── plan-mode.kern               ← handlers-plan-mode.kern
├── run.kern                     ← handlers-run.kern
├── team-brainstorm.kern         ← handlers-team-brainstorm.kern
├── team-forge.kern              ← handlers-team-forge.kern
└── team-tribunal.kern           ← handlers-team-tribunal.kern
```

### packages/core/src/kern/

```
models/                      # Types, interfaces, schemas
├── tool-types.kern              ← tool-types.kern
├── extension-manifest.kern      ← extension-manifest.kern
├── errors.kern                  ← errors.kern
└── types.kern                   ← types.kern (if exists)

signals/                     # Registries, state, config
├── config.kern                  ← config.kern
├── tool-registry.kern           ← tool-registry.kern
├── engine-registry.kern         ← engine-registry.kern
├── command-registry.kern        ← command-registry.kern
├── event-bus.kern               ← event-bus.kern
├── elo.kern                     ← elo.kern
├── chat-store.kern              ← chat-store.kern
└── flow.kern                    ← flow.kern

blocks/                      # Reusable logic units
├── process.kern                 ← process.kern
├── skill-loader.kern            ← skill-loader.kern
├── hooks.kern                   ← hooks.kern
├── extension-loader.kern        ← extension-loader.kern
├── builtin-commands.kern        ← builtin-commands.kern
├── context-scanner.kern         ← context-scanner.kern
├── engine-discover.kern         ← engine-discover.kern
├── engine-memory.kern           ← engine-memory.kern
├── tool-orchestration.kern      ← tool-orchestration.kern
├── clipboard.kern               ← clipboard.kern
├── git.kern                     ← git.kern
└── sidechain-logger.kern        ← sidechain-logger.kern

cesar/                       # Orchestrator domain
├── plan.kern                    ← cesar-plan.kern
├── plan-formatter.kern          ← cesar-plan-formatter.kern
└── memory.kern                  ← cesar-memory.kern
```

## Migration Rules

1. **File moves are renames** — `git mv` to preserve history
2. **All imports must update** — `./cesar-brain.js` → `./cesar/brain.js` (the generated .ts files)
3. **Generated output mirrors source structure** — `kern compile kern/cesar/brain.kern --outdir=generated` → `generated/cesar/brain.ts`
4. **Facade files must update** — thin re-export files in `src/handlers/`, `src/` etc.
5. **Tests reference generated paths** — update import paths in all test files
6. **CLAUDE.md must update** — references to file locations

## Compilation

The KERN compiler preserves relative directory structure:
```bash
kern compile src/kern/ --outdir=src/generated --recursive
```

This compiles `kern/cesar/brain.kern` → `generated/cesar/brain.ts`, etc.

Currently each file is compiled individually. After this refactor, the `--recursive` flag can compile the entire tree at once.

## Import Pattern Change

Before:
```kern
import from="./cesar-confidence.js" names="CONFIDENCE_TIERS"
import from="./cesar-session.js" names="ensureCesarSession"
```

After:
```kern
import from="./cesar/confidence.js" names="CONFIDENCE_TIERS"
import from="./cesar/session.js" names="ensureCesarSession"
```

For cross-domain imports (e.g., cesar importing from signals):
```kern
import from="../signals/intent.js" names="detectIntent"
```

## Facade Updates

Current facade pattern (e.g., `src/handlers/cesar-brain.ts`):
```ts
export * from '../generated/handlers-cesar-brain.js';
```

After:
```ts
export * from '../generated/cesar/brain.js';
```

## Monolith Splits (Optional, High Value)

While moving files, split these monoliths:

| File | Lines | Split into |
|---|---|---|
| `app-dispatch.kern` | 780 | `signals/dispatch.kern` (router) + `signals/dispatch-plan.kern` (plan commands) + `signals/dispatch-jobs.kern` (job commands) |
| `ui-app.kern` | 770 | `surfaces/app.kern` (layout + state) + `surfaces/app-submit.kern` (handleSubmit) + `surfaces/app-keys.kern` (keyboard handlers) |
| `handlers-cesar-brain.kern` | 680 | `cesar/brain.kern` (streaming) + `cesar/brain-escalation.kern` (post-stream escalation) + `cesar/brain-tools.kern` (tool loop) |

## Verification

```bash
# After all moves + import updates:
kern compile src/kern/ --outdir=src/generated --recursive    # or per-file
npm run typecheck
npm run test       # all 720+ tests must pass
npm run build
```

## Execution Order

1. Create target directories (`surfaces/`, `blocks/`, `signals/`, `models/`, `cesar/`, `handlers/`)
2. `git mv` all files (preserves history)
3. Update all imports in moved .kern files
4. Recompile all .kern → generated/
5. Update facade .ts files
6. Update test imports
7. Update CLAUDE.md
8. Run typecheck + tests
9. Optional: split monoliths (separate commit)

## Risk

- **Medium risk** — lots of file moves and import updates, but each is mechanical
- **Zero logic changes** — only file paths change, no behavior changes
- **Git history preserved** — `git mv` tracks the rename
- **Rollback easy** — `git reset --hard` if anything breaks

## Estimated Effort

- File moves: ~30 minutes (mechanical `git mv`)
- Import updates: ~2 hours (grep + replace across 149 files)
- Facade updates: ~30 minutes
- Test updates: ~30 minutes
- Monolith splits: ~2 hours (optional, separate commit)
- Total: ~3-5 hours
