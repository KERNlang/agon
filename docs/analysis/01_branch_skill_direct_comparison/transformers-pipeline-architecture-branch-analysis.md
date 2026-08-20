# Transformers Pipeline Architecture Branch Analysis

Date: 2026-06-25

Workspace checkout: `/Users/mrryf/develop/agon_testing/repo`

Branch inspected: `analysis/transformers-pipeline-architecture`

## Scope

This artifact records a 15-step sequential-thinking analysis of the Agon branch at:

`https://github.com/rotwurstesser/agon/tree/analysis/transformers-pipeline-architecture`

The branch changes one file relative to `origin/main`:

- `docs/transformers-pipeline-architecture-analysis.md`

The branch file is an analysis note, not an implementation patch. The review therefore verified its claims against local KERN sources, generated TypeScript, tests, docs, and the installed local Agon package.

## Sequential-Thinking Record

1. Defined the review target: inspect the branch for concrete claims about Transformers pipeline architecture and Agon workflow routing.
2. Scoped the branch: `git diff origin/main...HEAD` shows only `docs/transformers-pipeline-architecture-analysis.md`.
3. Treated the branch doc as a recommendation artifact whose claims must be verified locally.
4. Verified slash `/pipeline`: `packages/cli/src/kern/signals/intent.kern` parses `/pipeline`/`/pipe` into intent type `pipeline`; `intent-orchestration.kern` dispatches to `handlePipeline`.
5. Verified `handlePipeline`: `packages/cli/src/kern/handlers/pipeline.kern` is a mutable single-engine build -> fitness -> parallel review -> fix loop with up to three iterations.
6. Verified `agon call pipeline`: `packages/cli/src/kern/commands/call.kern` expands to `brainstorm`, `forge`, then `tribunal`.
7. Verified MCP direct mode: `packages/mcp/src/kern/agon-orchestration.kern` maps external `Pipeline` tool calls to `agon call pipeline`.
8. Verified MCP in-session mode: with signal transport, the MCP server writes a `Pipeline` signal; Cesar converts that to a pending delegation; `cesar-router.kern` routes `pipeline` to `handlePipeline`.
9. Verified plan-mode `pipeline`: `packages/cli/src/kern/handlers/plan-mode.kern` has a separate executor commented as `Pipeline = brainstorm -> forge -> tribunal chain`.
10. Verified mutation/apply behavior: plan-mode `forge` and `teamforge` call `applyForgeWinnerToCwd`, while plan-mode `pipeline` calls `runForge` and then `runTribunal` without applying the winning patch to `cwd`.
11. Verified docs drift: README advertises `pipeline` as a single-engine build-review-fix loop; AGENT.md describes call-facing `pipeline` as brainstorm-forge-tribunal; generated `docs/modes.md` does not list a top-level `agon pipeline` command while call/MCP still expose a pipeline workflow.
12. Identified fragmented inventories: slash command registry, MCP tool schemas, core tool handlers, plan step types, and `AGON_MODE_NAMES` each hold partial workflow metadata.
13. Judged the contract-table abstraction as useful for metadata and parity tests, not as a first-step universal runner factory.
14. Identified the smallest safe implementation slice: a KERN-sourced contract inventory for the conflicted `pipeline` family plus parity tests that make current behavior explicit.
15. Final conclusion: the branch recommendation is sound if framed as contract discipline and parity testing, not as copying the Hugging Face ML runtime/class hierarchy.

## Verified Source Map

### Branch Artifact

- `docs/transformers-pipeline-architecture-analysis.md` states the key conclusion: copy contract discipline, not the ML runtime hierarchy.
- It lists the target discipline as canonical workflow IDs, alias normalization, central supported workflow inventory, declared defaults/inputs/artifacts, and cross-surface parity tests.
- It identifies `pipeline` as the concrete drift case across slash, call, MCP, in-session, and plan-mode surfaces.

### Slash And In-Session Pipeline

- `packages/cli/src/kern/signals/intent.kern` registers `/pipeline` as `<task> [test with <cmd>] -- build->review->fix loop`.
- `packages/cli/src/generated/signals/intent.ts` parses `pipeline` and `pipe` into `{ type: 'pipeline', task, fitnessCmd }`.
- `packages/cli/src/kern/signals/dispatch/intent-orchestration.kern` routes that intent to `handlePipeline`.
- `packages/cli/src/kern/signals/dispatch/cesar-router.kern` routes Cesar action `pipeline` to `handlePipeline`.
- `packages/cli/src/kern/handlers/pipeline.kern` implements the build-review-fix loop:
  - selects one build engine;
  - optionally runs a fitness command;
  - runs reviewers in parallel;
  - feeds blocking review feedback into the next iteration;
  - stops after review/fitness passes or after the iteration cap.

Conclusion: slash and in-session Cesar/MCP pipeline mean build-review-fix.

### `agon call pipeline`

- `packages/cli/src/kern/commands/call.kern` normalizes workflow names and expands `pipeline` into three commands:
  - `brainstorm`;
  - `forge`;
  - `tribunal`.
- `tests/unit/call-command.test.ts` pins this mapping in the test named `maps pipeline to brainstorm, forge, then tribunal`.

Conclusion: `agon call pipeline` means brainstorm-forge-tribunal.

### MCP Direct Pipeline

- `packages/mcp/src/kern/agon-orchestration.kern` defines external MCP `Pipeline` as "Run or delegate the full pipeline: brainstorm -> forge -> tribunal."
- Its direct command builder emits `['call', 'pipeline', ...]`.

Conclusion: MCP outside an active Agon session inherits `agon call pipeline`, so it means brainstorm-forge-tribunal.

### MCP In-Session Pipeline

- `packages/mcp/src/kern/agon-orchestration.kern` writes a signal when `AGON_SIGNAL_DIR` and `AGON_SESSION_ID` are present.
- `packages/cli/src/kern/cesar/brain.kern` reads MCP signals and stores the first orchestration signal as `pendingDelegation`.
- `packages/cli/src/kern/signals/dispatch/cesar-router.kern` handles the `pipeline` delegation by invoking `handlePipeline`.

Conclusion: MCP inside an active Agon session means build-review-fix.

### Plan-Mode Pipeline

- `packages/cli/src/kern/handlers/plan-mode.kern` defines valid plan step type `pipeline` and executes it through a custom executor.
- That executor runs `runBrainstorm`, then `runForge`, then `runTribunal`.
- The plain `forge` and `teamforge` plan executors call `applyForgeWinnerToCwd(manifest)`.
- The `pipeline` plan executor does not call `applyForgeWinnerToCwd(manifest)` after `runForge`.

Conclusion: plan-mode `pipeline` is the chain behavior, but its current mutation/apply semantics are weaker than plain plan-mode forge/teamforge.

### Existing Metadata Fragments

- `packages/core/src/kern/signals/command-registry.kern` and `packages/core/src/kern/blocks/builtin-commands.kern` describe slash commands.
- `packages/mcp/src/kern/agon-orchestration.kern` describes MCP orchestration tools.
- `packages/core/src/kern/blocks/tool-orchestration.kern` describes core tool handlers, including a `Pipeline` tool that itself says build-review-fix.
- `packages/core/src/kern/cesar/plan.kern` defines `CESAR_STEP_TYPES`.
- `packages/core/src/kern/models/errors.kern` defines `AGON_MODE_NAMES`.

Conclusion: Agon already has partial inventories, but no single contract table that can prove the same workflow means the same thing across surfaces.

## Claims Verified

- The branch is correct that `pipeline` is overloaded.
- The branch is correct that alias/workflow inventories and parity tests would catch this class of drift.
- The branch is correct that copying Hugging Face's ML class hierarchy would be ceremony for Agon.
- The branch's plugin implication is plausible: plugin-provided workflows would inherit current drift unless the host first defines canonical workflow contracts.

## Nuances And Corrections

- The branch should frame the issue as "pipeline family drift" rather than "all Agon workflows lack discipline." Several individual surfaces have tests and registries already.
- The plan-mode issue is not "plan forge never applies." Plain plan-mode forge and teamforge do apply winning patches. The risk is specific to plan-mode `pipeline`.
- The installed local Agon package also shows the split: bundled plan-mode pipeline is chain behavior, while the core `createPipelineTool` describes build-review-fix.

## Smallest Safe Implementation Slice

1. Add a KERN-source workflow contract table for first-party workflows, initially focused on `pipeline`.
2. Give the overloaded meanings distinct canonical IDs before adding plugin machinery:
   - possible `build-pipeline` for the build-review-fix handler;
   - possible `orchestration-chain` or `brainstorm-forge-tribunal` for the chain.
3. Include metadata fields only, not a runner factory:
   - canonical id;
   - aliases and surface names;
   - supported surfaces;
   - input schema summary;
   - required capabilities;
   - mutates workspace;
   - apply behavior;
   - output artifacts;
   - permission/preflight expectations;
   - docs label.
4. Add parity tests that verify current or intended behavior across:
   - slash;
   - `agon call`;
   - MCP direct;
   - MCP in-session signal route;
   - plan-mode;
   - generated docs/help text.
5. Only after those tests pass, consider exposing the same contract type to plugins.

## Bottom Line

The branch's architectural idea is useful for Agon if treated as contract discipline: canonical workflow IDs, aliases, inventories, schemas, mutation/apply semantics, preflight, artifacts, and parity tests.

It should not become a Transformers-style runtime hierarchy. The next safe step is to make the `pipeline` split explicit or eliminate it before building a registry or plugin workflow system on top.
