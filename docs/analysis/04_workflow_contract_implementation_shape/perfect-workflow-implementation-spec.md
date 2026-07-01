# Full Vertical Workflow Kernel V1 Acceptance Spec

Status: corrected implementation-shape spec for the
`analysis/transformers-pipeline-architecture` branch.

Date: 2026-06-29.

This replaces the earlier version of this document. The previous version was
wrong because it kept graph execution, plugin admission, flow verification,
and dispatch wiring outside the first accepted implementation. This version
defines V1 as a constrained but complete vertical workflow kernel: every major
layer is present in V1 and must be proven by tests.

V1 is not "minimal." V1 is bounded. It supports the exact semantics described
here and rejects unsupported semantics explicitly.

## Analysis Inputs

- Existing branch analysis under `docs/transformers-pipeline-architecture-analysis.md`.
- Friend's workflow evidence under `docs/analysis/01_*`, `02_*`, and `03_*`.
- Repo verification of current `pipeline`, `call`, plan-mode, intent dispatch,
  and core flow telemetry files.
- Five MCP sequential-thinking passes, 20 steps each.
- Five local/private Agon cycles. Each cycle ran brainstorm, tribunal, and
  synthesis. External-provider Agon rosters were not used because the approval
  reviewer previously rejected exporting private repo-derived architecture
  context to external providers.

The Agon runs used local/private engines and wrote artifacts under
`/Users/ra/.agon/runs/`. Important final-cycle runs:

- `brainstorm-1782724701927-vlxx7b-full-workflow-pass5-brainstorm`
- `tribunal-1782724850416-oo5hnp-full-workflow-pass5-tribunal`
- `synthesis-1782725011534-zdxc4v-full-workflow-pass5-synthesis`

Earlier Agon outputs that referenced nonexistent repo files or generic
non-Agon layouts were rejected. This document uses repo-real package boundaries.

## Verified Repo Facts

- `packages/core/src/kern/signals/flow.kern` defines the current flow telemetry
  model: `FlowRecord`, `FlowTelemetry`, `FlowModeMeta`, `FlowFeedback`,
  `logFlow`, `readFlows`, and `analyzeFlows`.
- `packages/core/src/flow.ts` exports the generated flow telemetry APIs.
- `packages/cli/src/kern/handlers/pipeline.kern` implements slash/in-session
  `pipeline` as a build -> fitness -> review/fix loop.
- `packages/cli/src/kern/commands/call.kern` expands `agon call pipeline` into
  `brainstorm`, then `forge`, then `tribunal`.
- `packages/cli/src/kern/handlers/plan-mode.kern` contains plan-mode pipeline
  behavior related to the brainstorm -> forge -> tribunal family.
- `packages/cli/src/kern/signals/dispatch/*` and
  `packages/cli/src/kern/signals/intent.kern` route slash/Cesar/in-session
  intents.
- Generated TypeScript is not the canonical place for this system when KERN
  source exists.

## Acceptance Definition

V1 is accepted only when the repo contains a KERN-sourced workflow kernel that
can:

1. Register and resolve first-party and admitted plugin workflow specs.
2. Represent workflows as graph specs.
3. Validate and compile those graphs into execution plans.
4. Execute those plans through trusted node handlers/adapters.
5. Emit workflow run and phase events into flow telemetry.
6. Verify runtime flow against the declared workflow and graph contract.
7. Enforce capability, mutation, alias, and adapter-trust policies before
   side-effectful execution.
8. Prove the above through unit and integration tests.

Acceptance is not a claim of general-purpose workflow-engine completeness or
production safety for untrusted code. It is a precise claim that the constrained
V1 semantics below are implemented and tested.

## V1 Semantics

V1 supports:

- Linear DAG graph execution.
- Bounded composite loop nodes with explicit `maxIterations`.
- Trusted first-party node handlers and admitted trusted adapter node handlers.
- Surface-scoped aliases.
- Static plugin workflow admission.
- Runtime workflow-run isolation.
- Flow verification before and during execution.

V1 does not support:

- unbounded loops;
- cyclic graphs;
- dynamic graph mutation after compile;
- arbitrary untrusted plugin code;
- post-boot plugin injection outside registry admission;
- global `pipeline` alias ownership;
- hidden registry entries;
- cross-run shared mutable workflow state;
- runtime graph rewrites;
- implicit mutation without a mutation policy.

These are unsupported V1 semantics, not absent architecture layers.

## Core Package Shape

The workflow kernel belongs under a new KERN domain:

```text
packages/core/src/kern/workflows/
  types.kern
  specs.kern
  registry.kern
  graph.kern
  compiler.kern
  execution.kern
  conformance.kern
  plugins.kern
  flow-verification.kern
```

Generated TypeScript should be produced by the existing KERN compile flow under
`packages/core/src/generated/`, then exported from `packages/core/src/index.ts`
or a dedicated core facade.

### `types.kern`

Defines shared workflow identity and lifecycle types:

- `WorkflowId`
- `WorkflowVersion`
- `WorkflowSurface`
- `WorkflowAlias`
- `WorkflowRun`
- `WorkflowPhaseEvent`
- `WorkflowError`
- `WorkflowCapability`
- `WorkflowMutationPolicy`
- `WorkflowAuthorityPolicy`
- `WorkflowArtifactSpec`

`WorkflowRun` must include:

- `runId`
- `workflowId`
- `workflowVersion`
- `graphId`
- `surface`
- `surfaceAlias`
- `startedAt`
- `endedAt`
- `status`
- ordered `WorkflowPhaseEvent[]`
- structured error data when failed

### `specs.kern`

Defines `WorkflowSpec`.

Required fields:

- `id`
- `version`
- `title`
- `sourceKind`
- `surfaces`
- `aliases`
- `graphId`
- `graph`
- `inputs`
- `outputs`
- `artifacts`
- `mutation`
- `authority`
- `capabilities`
- `conformance`

The spec must distinguish semantic workflow ids from surface aliases. A public
string like `pipeline` is not a workflow id.

### `registry.kern`

Defines `WorkflowRegistry` and registry operations:

- register first-party specs;
- register admitted plugin specs;
- resolve by workflow id and version;
- resolve surface-scoped aliases;
- reject duplicate canonical ids;
- reject duplicate aliases within the same surface;
- reject reserved aliases for plugins;
- report explicit known legacy aliases.

Reserved aliases include `pipeline` for the current V1 work. `pipeline` may be
resolved only through a surface-scoped first-party alias policy.

### `graph.kern`

Defines `WorkflowGraphSpec`.

V1 graph node kinds:

- `normal`
- `trustedComposite`
- `boundedLoop`
- `humanGate`
- `externalAdapter`

Required graph checks:

- one entry node;
- all node ids unique;
- all edges reference existing nodes;
- all artifact/input/output references resolve;
- no cycles except explicitly bounded loop semantics;
- every loop has finite `maxIterations`;
- every node declares required capabilities and mutation behavior.

### `compiler.kern`

Defines graph validation and compilation:

- `validateWorkflowGraph`
- `compileWorkflowGraph`
- `compileWorkflowSpec`

The compiler produces a `WorkflowExecutionPlan`. The logical plan must be
deterministic for the same `WorkflowSpec` and `WorkflowGraphSpec` inputs, after
excluding run metadata such as timestamps, UUIDs, and durations.

V1 compilation must reject:

- cyclic graphs;
- unbounded loops;
- missing handlers;
- unresolved artifacts;
- capability mismatches;
- unsupported node kinds;
- global aliases in workflow definitions.

### `execution.kern`

Defines the V1 plan executor interface and trusted handler boundary.

Core owns the pure execution contract:

- plan traversal;
- run context creation;
- workflow-run isolation;
- capability checks before node execution;
- phase event emission;
- structured errors;
- flow verification hooks.

Effectful node handlers live in CLI/forge/adapter packages and are injected
through trusted handler/adaptor registration. Core must not own terminal UI,
shell specifics, or provider-specific side effects.

### `conformance.kern`

Defines static and runtime conformance reports:

- `WorkflowConformanceReport`
- `WorkflowConformanceFinding`
- `WorkflowConformanceSeverity`

Conformance must check:

- spec validity;
- registry validity;
- alias policy;
- graph validity;
- capability policy;
- mutation policy;
- plugin admission;
- flow verification result.

### `plugins.kern`

Defines V1 plugin workflow admission:

- plugin id and version;
- declared workflow specs;
- declared graph specs;
- declared node handlers;
- trusted adapter kind;
- required capabilities;
- mutation policy;
- authority policy;
- external-provider policy.

V1 supports admitted workflow plugins with trusted adapter handlers. It does not
support arbitrary third-party code execution. "Trusted" means registered through
the V1 admission policy and allowed by the runtime's trusted-adapter list or
first-party registry. Do not claim automatic sandboxing unless such sandboxing is
actually implemented.

### `flow-verification.kern`

Extends current flow telemetry without breaking existing flow records.

V1 should add optional workflow identity metadata to existing flow structures,
or add a linked `WorkflowRun` record while preserving current `readFlows` and
`analyzeFlows` behavior for older records.

Required metadata for workflow-bound runs:

- `workflowId`
- `workflowVersion`
- `workflowRunId`
- `workflowGraphId`
- `workflowSurface`
- `workflowAlias`
- `phaseSummary`

Verification must check:

- all required phase events are present;
- phase ordering matches the compiled plan;
- node events carry the correct run id;
- no events from another workflow run are accepted;
- bounded loop event counts do not exceed `maxIterations`;
- failures produce structured workflow errors.

## Package Ownership

### Core

Core owns:

- workflow data model;
- registry;
- graph model;
- compiler;
- pure execution contract;
- conformance;
- plugin admission;
- flow verification;
- shared errors and events.

### CLI

CLI wires user-facing and session-facing surfaces to the workflow kernel:

```text
packages/cli/src/kern/handlers/pipeline.kern
packages/cli/src/kern/commands/call.kern
packages/cli/src/kern/handlers/plan-mode.kern
packages/cli/src/kern/signals/intent.kern
packages/cli/src/kern/signals/dispatch/intent-meta.kern
packages/cli/src/kern/signals/dispatch/intent-orchestration.kern
packages/cli/src/kern/signals/dispatch/cesar-router.kern
```

CLI must not keep separate hidden workflow semantics for the two `pipeline`
families. It must resolve workflow ids through the registry, compile or retrieve
the corresponding graph plan, and execute through the workflow kernel entry.

### Forge

Forge owns effectful forge/brainstorm/tribunal-style node handler
implementations and adapter-heavy runtime concerns. It should consume compiled
workflow execution plans or node execution requests rather than owning workflow
identity, alias policy, or graph schema.

### MCP

MCP exposes workflow-aware tools and metadata. It should resolve MCP workflow
tools to registry workflow ids and report conformance status. MCP does not own
the workflow schema.

## First-Party Workflow Certification

V1 must certify at least these workflows.

### `agon.build-review-fix@v1`

Current source family:

- slash `/pipeline`
- Cesar/in-session `pipeline`
- `packages/cli/src/kern/handlers/pipeline.kern`

Semantic contract:

```text
build -> fitness -> review/fix
```

V1 graph:

- graph entry is registry-resolved;
- graph contains a trusted composite bounded-loop node;
- composite adapter wraps the current handler behavior;
- child phases `build`, `fitness`, `review`, and `fix` are represented as
  required phase events;
- `maxIterations` is explicit;
- phase events are written into `WorkflowRun` and flow telemetry.

This is graph execution. The top-level execution path is registry -> graph ->
compile -> execute. The composite node is a V1 node kind, not a bypass.

### `agon.brainstorm-forge-tribunal@v1`

Current source family:

- `agon call pipeline`
- plan-mode `pipeline`
- `packages/cli/src/kern/commands/call.kern`
- `packages/cli/src/kern/handlers/plan-mode.kern`

Semantic contract:

```text
brainstorm -> forge -> tribunal
```

V1 graph:

- graph entry is registry-resolved;
- graph contains normal nodes for brainstorm, forge, and tribunal;
- artifacts carry brainstorm output, forge result, and tribunal review;
- execution emits phase events for each node;
- current hardcoded command expansion is replaced or wrapped by graph-plan
  execution so that the workflow does not bypass registry/conformance.

## Alias Policy

`pipeline` is not a canonical workflow id.

V1 alias resolution:

| Surface | Alias | Workflow id |
| --- | --- | --- |
| slash/in-session | `pipeline` | `agon.build-review-fix@v1` |
| Cesar/in-session | `pipeline` | `agon.build-review-fix@v1` |
| `agon call` | `pipeline` | `agon.brainstorm-forge-tribunal@v1` |
| plan-mode step | `pipeline` | `agon.brainstorm-forge-tribunal@v1` |

Plugins may not register `pipeline` as a global alias. If alias resolution is
session-scoped in implementation, document it as session-scoped; do not claim
permanent global blocking beyond the registry/surface policy that actually
exists.

## Capability And Mutation Policy

Capabilities are runtime-enforced execution concerns, not just plugin metadata.

Every node must declare:

- required capabilities;
- read/write behavior;
- workspace mutation behavior;
- external-provider authority;
- secret-bearing behavior if applicable;
- rollback/idempotency expectations for side-effectful actions.

The executor must check capability admission before the node performs
side effects. Capability denial fails before node execution and emits a
structured error.

## Error Handling

V1 must define and test these error codes:

- `INVALID_WORKFLOW_SPEC`
- `DUPLICATE_WORKFLOW_ID`
- `DUPLICATE_WORKFLOW_ALIAS`
- `RESERVED_ALIAS`
- `INVALID_GRAPH`
- `UNSUPPORTED_NODE_KIND`
- `UNBOUNDED_LOOP`
- `BOUNDED_LOOP_EXCEEDED`
- `CAPABILITY_DENIED`
- `ADAPTER_NOT_TRUSTED`
- `PLUGIN_NOT_ADMITTED`
- `FLOW_VERIFICATION_FAILED`
- `PHASE_EVENT_ORDER_INVALID`
- `WORKFLOW_RUN_ISOLATION_VIOLATION`
- `WORKFLOW_EXECUTION_FAILED`

Failure behavior must be explicit:

- invalid specs fail at registry/admission time;
- invalid graphs fail at compile time;
- capability denial fails before side effects;
- untrusted adapter references fail before node execution;
- runtime node failures emit workflow error events and mark the run failed;
- side-effect rollback is not implied unless a node declares and implements a
  compensation policy.

## Observability

V1 workflow execution must emit structured events:

- `workflow.start`
- `workflow.end`
- `workflow.error`
- `node.start`
- `node.end`
- `node.error`
- `phase.start`
- `phase.end`
- `phase.error`
- `capability.denied`
- `adapter.rejected`
- `conformance.failed`
- `flow.verification.failed`

Each event must include:

- `workflowRunId`
- `workflowId`
- `workflowVersion`
- `workflowGraphId`
- `surface`
- `surfaceAlias`
- `nodeId` when applicable;
- `phase` when applicable;
- timestamp or monotonic ordering data;
- duration when available;
- structured error details when failed.

## Acceptance Test Matrix

V1 is not accepted without tests that cover every layer.

| Area | Required proof |
| --- | --- |
| Registry | first-party specs load; duplicate ids fail; missing ids fail clearly |
| Alias policy | `pipeline` resolves differently by surface; plugin `pipeline` alias fails |
| Workflow specs | both certified workflows validate against `WorkflowSpec` |
| Graph validation | missing nodes, invalid edges, cycles, and unbounded loops fail |
| Compiler | same logical spec/graph compiles to same logical plan ignoring run metadata |
| Execution | normal node plan executes and emits ordered node events |
| Composite node | build-review-fix bounded composite emits child phase events |
| Bounded loops | executor halts at `maxIterations` and reports bounded-loop status |
| Capabilities | node with missing capability fails before side effects |
| Mutation policy | mutating node without mutation policy fails admission |
| Plugin admission | admitted plugin spec registers; reserved alias/untrusted adapter fails |
| Flow verification | missing/out-of-order phase events fail verification |
| WorkflowRun isolation | concurrent runs cannot share mutable workflow run state |
| CLI slash wiring | `/pipeline` resolves to `agon.build-review-fix@v1` |
| CLI call wiring | `agon call pipeline` resolves to `agon.brainstorm-forge-tribunal@v1` |
| Plan-mode wiring | plan-mode `pipeline` resolves through registry/conformance |
| MCP wiring | MCP Pipeline/tool metadata resolves to workflow ids and conformance state |
| Error events | expected error codes emit structured workflow error events |
| Backward flow compatibility | old flow records without workflow metadata remain readable |

Suggested test file targets:

```text
tests/unit/workflow-registry.test.ts
tests/unit/workflow-alias-policy.test.ts
tests/unit/workflow-graph.test.ts
tests/unit/workflow-compiler.test.ts
tests/unit/workflow-conformance.test.ts
tests/unit/workflow-plugin-admission.test.ts
tests/unit/workflow-flow-verification.test.ts
tests/unit/workflow-run-isolation.test.ts
tests/integration/workflow-pipeline-slash.test.ts
tests/integration/workflow-pipeline-call.test.ts
tests/integration/workflow-plan-mode.test.ts
tests/integration/workflow-mcp-tooling.test.ts
```

Use existing repo test conventions when implementing; the names above are
targets for coverage, not a command to invent a parallel test framework.

## Implementation Acceptance Order

These are all V1 work items. They are ordered for implementation, not separated
into later architecture layers.

1. Add core workflow types/specs/registry.
2. Add graph model, compiler, and conformance checks.
3. Add execution plan contract and injected trusted node handler boundary.
4. Add flow identity and workflow-run verification.
5. Add plugin workflow admission and trusted adapter policy.
6. Add first-party specs and graphs for both pipeline families.
7. Wire `call.kern` to `agon.brainstorm-forge-tribunal@v1`.
8. Wire `pipeline.kern` to `agon.build-review-fix@v1` through a trusted
   composite bounded-loop node.
9. Wire plan-mode and intent dispatch to registry/conformance.
10. Expose MCP workflow id/conformance metadata.
11. Add the full acceptance test matrix.
12. Run KERN compile and repo tests.

## What Not To Copy From Transformers

Do not copy Hugging Face's ML pipeline class hierarchy or universal pipeline
runtime.

Do copy the discipline:

- explicit task identity;
- task-specific requirements;
- registry-based construction;
- validation before runtime use;
- predictable inputs and outputs;
- clear artifact and component contracts.

For Agon, that means workflow identity, graph contracts, registry admission,
flow verification, and trusted execution.

## Final Shape

The perfect V1 shape is:

```text
WorkflowSpec
  -> WorkflowRegistry
  -> WorkflowGraphSpec
  -> WorkflowCompiler
  -> WorkflowExecutionPlan
  -> Trusted WorkflowExecutor
  -> WorkflowRun + Flow telemetry
  -> WorkflowConformanceReport
```

Plugins participate through:

```text
PluginWorkflowSpec
  -> registry admission
  -> capability/mutation policy
  -> trusted adapter node handler
  -> same graph/compiler/executor/conformance path
```

The `pipeline` name is demoted to a surface-scoped legacy alias. The workflows
are `agon.build-review-fix@v1` and `agon.brainstorm-forge-tribunal@v1`.

This keeps every major layer in V1 while making the semantics bounded,
testable, and honest.
