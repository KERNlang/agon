# Transformers Pipeline Architecture Analysis for Agon

Status: deep analysis artifact on branch `analysis/transformers-pipeline-architecture`.

Date: 2026-06-24.

This file is intentionally an analysis note, not an implementation patch. It
records what was verified in Hugging Face Transformers.js, Python Transformers,
and the local Agon repo, then turns that into a conservative recommendation for
what Agon should copy.

Note: this repository currently ignores `docs/*`, so this file is local unless
force-added later.

## Executive Decision

Do not copy Hugging Face's pipeline architecture literally.

Do copy its contract discipline:

1. Canonical task/workflow ids.
2. Explicit alias normalization.
3. A central supported-workflow inventory.
4. Declared defaults and expected inputs/artifacts.
5. Cross-surface parity tests so CLI, slash, MCP, plan-mode, and docs cannot
   silently drift.

The immediate target is Agon's overloaded `pipeline` behavior. Verified local
evidence shows that `pipeline` means different things depending on entrypoint.
That is the concrete problem a Transformers-style inventory can help solve.

## Source Inventory

Verified external sources inspected locally:

- `@huggingface/transformers` npm package, version `4.2.0`, unpacked from
  `/tmp/huggingface-transformers-4.2.0.tgz`.
- Transformers.js pipeline factory:
  `/tmp/hf-transformers-js-4.2.0/src/pipelines.js`.
- Transformers.js supported task registry:
  `/tmp/hf-transformers-js-4.2.0/src/pipelines/index.js`.
- Transformers.js base callable pipeline:
  `/tmp/hf-transformers-js-4.2.0/src/pipelines/_base.js` and
  `/tmp/hf-transformers-js-4.2.0/src/utils/generic.js`.
- Transformers.js model registry helpers:
  `/tmp/hf-transformers-js-4.2.0/src/utils/model_registry/ModelRegistry.js` and
  `/tmp/hf-transformers-js-4.2.0/src/utils/model_registry/get_pipeline_files.js`.
- Python Transformers pipeline files fetched to:
  `/tmp/hf-transformers-py-base.py`,
  `/tmp/hf-transformers-py-init.py`,
  `/tmp/hf-transformers-py-text-generation.py`.

Verified local Agon sources inspected:

- `packages/cli/src/kern/commands/call.kern`
- `packages/cli/src/generated/commands/call.ts`
- `packages/cli/src/kern/signals/intent.kern`
- `packages/cli/src/generated/signals/intent.ts`
- `packages/cli/src/kern/signals/dispatch/intent-orchestration.kern`
- `packages/cli/src/generated/signals/dispatch/intent-orchestration.ts`
- `packages/cli/src/kern/signals/dispatch/cesar-router.kern`
- `packages/cli/src/generated/signals/dispatch/cesar-router.ts`
- `packages/cli/src/kern/signals/dispatch/delegation.kern`
- `packages/cli/src/generated/signals/dispatch/delegation.ts`
- `packages/cli/src/kern/handlers/plan-mode.kern`
- `packages/cli/src/generated/handlers/plan-mode.ts`
- `packages/cli/src/kern/handlers/forge.kern`
- `packages/cli/src/generated/handlers/forge.ts`
- `packages/mcp/src/generated/agon-orchestration.ts`

## What Transformers.js Actually Does

Verified:

- `pipeline(task, model?, options?)` is the public entry point.
- The factory applies `TASK_ALIASES[task] ?? task`.
- It validates the canonical task against `SUPPORTED_TASKS`.
- If the caller omits a model, it selects the task default model and sometimes
  default dtype.
- It computes expected files through `get_pipeline_files(task, model, ...)`.
- It prepares progress metadata for expected files.
- It resolves tokenizer/processor presence from expected files.
- It resolves the model class, including config-based matching when multiple
  model classes support a task.
- It loads tokenizer, processor, and model in parallel with `Promise.all`.
- It returns `new pipelineClass({ task, model, tokenizer?, processor? })`.

Important correction from the deeper pass:

Transformers.js does not strongly teach the Python four-phase pipeline base.
The JavaScript base pipeline is mainly a callable object wrapper. Concrete JS
pipelines implement `_call` directly. The `preprocess -> forward -> postprocess`
shape is much more explicit in Python Transformers than in Transformers.js.

## What Python Transformers Adds

Verified:

- `TASK_ALIASES` and `SUPPORTED_TASKS` live near the public factory.
- `PIPELINE_REGISTRY = PipelineRegistry(...)` centralizes supported tasks and
  aliases.
- `PipelineRegistry` can validate, resolve, and register tasks.
- The Python `Pipeline` base owns heavier shared behavior:
  `_sanitize_parameters`, `preprocess`, `_forward`, `postprocess`, batching,
  device placement, datasets, generators, and iterator behavior.

Inference:

That heavy base class is justified for ML workloads because many tasks share
model/tokenizer/processor/device/batching mechanics. Agon modes do not share
that internal dataflow. Copying the class hierarchy would create ceremony
without solving Agon's verified drift.

## Local Agon Pipeline Drift

Verified surface map:

| Surface | Current `pipeline` meaning | Evidence |
| --- | --- | --- |
| Slash `/pipeline` | Build -> fitness -> review/fix loop | `intent.kern` parses slash `pipeline`; `intent-orchestration.ts` dispatches to `handlePipeline`. |
| Cesar in-session action `pipeline` | Build -> fitness -> review/fix loop | `cesar-router.ts` calls `handlePipeline(...)` for route action `pipeline`. |
| MCP `Pipeline` outside an active Agon session | `agon call pipeline`, which expands to brainstorm -> forge -> tribunal | `agon-orchestration.ts` `buildDirectAgonCommand` emits `['call', 'pipeline', ...]`; `call.ts` expands it to three commands. |
| MCP `Pipeline` inside an active Agon session | Signals `Pipeline`; Cesar route can land on `handlePipeline` | `handleToolCall` writes a signal when signal transport exists; Cesar route `pipeline` calls `handlePipeline`. |
| `agon call pipeline` | Brainstorm -> forge -> tribunal | `call.kern` / `call.ts` build three commands: `brainstorm`, `forge`, `tribunal`. |
| Plan-mode step type `pipeline` | Brainstorm -> forge -> tribunal | `plan-mode.ts` lines around the pipeline executor call `runBrainstorm`, `runForge`, then `runTribunal`. |

Verified behavior concern:

- Plain plan-mode `forge` steps use `applyForgeWinnerToCwd(manifest)`.
- Plan-mode `pipeline` calls `runForge(...)` directly, checks
  `manifest.winner`, then runs tribunal.
- The plan-mode `pipeline` block does not call `applyForgeWinnerToCwd`.

Inference:

Plan-mode `pipeline` can report success with a forge winner and tribunal summary
while leaving `cwd` unchanged. That is narrower than "plan-mode forge never
applies"; plain forge steps do apply. The risk is specific to the special
pipeline step.

## What Is Worth Copying

Copy these ideas, translated into Agon's domain:

1. A KERN-derived supported-workflow table.

   Suggested fields:

   - canonical id
   - aliases
   - surfaces that expose it
   - required inputs
   - optional inputs
   - default fitness/rounds/timeouts
   - runner kind
   - mutates workspace
   - apply behavior
   - output artifacts
   - docs label

2. Early alias normalization.

   Normalize slash names, call workflow names, MCP PascalCase tool names, and
   plan step types into canonical workflow ids before dispatch.

3. Expected-contract preflight.

   Transformers computes expected files before loading components. Agon's analog
   is expected engines, cwd/worktree requirements, fitness command requirements,
   apply permissions, review requirements, and output artifacts.

4. Parallel independent setup where safe.

   Transformers loads independent components concurrently. Agon can use this
   pattern for independent health checks, context scans, and non-mutating
   preflight work. This should not be used for steps that share mutable state.

5. Generated docs and parity tests.

   `docs/modes.md` is already generated from KERN. The same discipline should
   cover workflow inventory and bridge behavior. Tests should assert that slash,
   call bridge, MCP direct, MCP in-session, plan-mode, and docs agree or
   explicitly document a deliberate difference.

## What Not To Copy

Do not copy:

- The Python `Pipeline` subclass hierarchy.
- The `_sanitize_parameters/preprocess/_forward/postprocess` method names as a
  universal Agon abstraction.
- The callable object pattern.
- Tokenizer/processor/model loading abstractions.
- ModelRegistry file discovery.
- Device/dtype/session abstractions.
- Generic batching/dataset iterator behavior.
- A global environment singleton like Transformers.js `env`.
- The name `PipelineRegistry`.

The name `PipelineRegistry` is especially bad for Agon because `pipeline` is
already semantically overloaded. Prefer domain names such as `WorkflowSpec`,
`WorkflowContract`, `CallWorkflowRegistry`, or `OrchestrationContract`.

## Recommendation

The deeper recommendation is sharper than the first pass:

1. First decide the semantic contract for `pipeline`.

   Either split the names, for example `build-pipeline` vs
   `orchestration-chain`, or make every surface use the same behavior. Do this
   before extracting shared runners.

2. Add parity tests for the current drift.

   Minimum tests:

   - `agon call pipeline` expands to the intended contract.
   - MCP direct `Pipeline` matches the intended contract.
   - MCP in-session `Pipeline` routes to the intended contract.
   - Slash `/pipeline` matches the intended contract or is explicitly named as a
     different workflow.
   - Plan-mode `pipeline` either applies the forge winner or declares/artifacts
     that it does not mutate `cwd`.

3. Create a small KERN-source workflow contract table.

   Do not start with a broad runtime registry. Start with metadata enough to
   generate/verify docs, aliases, bridge routing, and parity tests.

4. Then extract runners.

   After the contract is decided, extracting runner helpers is useful. Doing it
   first risks preserving the current split with cleaner code.

5. Only then consider a registry/factory.

   A registry is earned if multiple surfaces keep needing the same metadata:
   aliases, default options, expected inputs, expected artifacts, mutation/apply
   behavior, and runner identity.

## Agon Analysis Runs

External model passes used in this investigation:

- `agon think` with MiniMax M3 and Codex critic:
  `/Users/ra/.agon/runs/think-1782309400838-dg9xpy`
- `agon brainstorm` with Codex, Kimi, Claude, agy, OpenCode, MiniMax API, and
  MiniMax M3:
  `/Users/ra/.agon/runs/brainstorm-1782309400810-3jm7ju`
- `agon tribunal` on registry-first vs lifecycle-first:
  `/Users/ra/.agon/runs/tribunal-1782309400836-zkprzc`
- `agon council` with Codex chairman:
  `/Users/ra/.agon/runs/council-1782309621787-lrjz91`
- `agon nero` challenge:
  `/Users/ra/.agon/runs/nero-1782309752846-4dn6x2`

MCP sequential-thinking passes:

- Initial architecture pass.
- A second 20-step pass after verifying local code and Agon critique.

## Final Answer To "What Can We Copy?"

Copy the inventory, alias, contract, preflight, and parity-test discipline.

Do not copy the ML pipeline runtime.

The first implementation should focus on `pipeline` contract drift, not a
global abstraction. The fact that `pipeline` currently means different things
across slash, call, MCP, and plan-mode is exactly the kind of problem Hugging
Face's supported-task discipline prevents.
