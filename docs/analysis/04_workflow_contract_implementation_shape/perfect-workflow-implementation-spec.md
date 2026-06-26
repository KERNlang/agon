# Agon Workflow Contract Implementation Shape

Status: implementation-shape spec for the `analysis/transformers-pipeline-architecture` branch.
Date: 2026-06-26.

This document supersedes the earlier "small first patch" framing. The goal is
not minimalism. The goal is the right architecture shape, staged so that Agon can
grow into workflows, plugins, and eventually graph composition without turning
current drift into permanent truth.

## Analysis Inputs

- Existing branch analysis under `docs/transformers-pipeline-architecture-analysis.md`.
- Friend's workflow evidence under `docs/analysis/01_*`, `02_*`, and `03_*`.
- Local repo verification of the current `pipeline` and `flow` code.
- Sequential-thinking pass through the corrected framing.
- Local/private Agon runs:
  - Brainstorm:
    `/Users/ra/.agon/runs/brainstorm-1782473293460-6n1vix-perfect-workflow-shape-local-bro`
  - Tribunal:
    `/Users/ra/.agon/runs/tribunal-1782473626438-oxh0i4-perfect-workflow-shape-tribunal-`
  - Synthesis:
    `/Users/ra/.agon/runs/synthesis-1782474042084-s61ny8-perfect-workflow-shape-final-loc`

External-provider Agon rosters were not used for this final pass because the
approval reviewer rejected exporting private repo-derived architecture context.
The final pass used local/private engines only.

## Verified Repo Facts

- `packages/core/src/flow.ts` already exports KERN-sourced flow telemetry:
  `logFlow`, `readFlows`, `analyzeFlows`, `FLOWS_DIR`, and flow record types.
- `packages/core/src/kern/signals/flow.kern` defines flow as telemetry and
  analysis, not as a workflow declaration language.
- `packages/cli/src/kern/handlers/pipeline.kern` implements slash/in-session
  `pipeline` as a build -> fitness -> review/fix loop.
- `packages/cli/src/kern/commands/call.kern` expands `agon call pipeline` into
  `brainstorm`, then `forge`, then `tribunal`.
- Earlier branch evidence shows plan-mode `pipeline` also follows the
  brainstorm -> forge -> tribunal family and has application semantics drift.
- The repo does not currently contain a real `workflow-graph.kern`, `GraphSpec`
  executor, or MCP graph runtime. Tribunal claims that depended on those files
  were treated as invalid.
- KERN is already the canonical source for many core and CLI contracts in this
  repo. Generated TypeScript is not the place to manually define this system
  when a KERN source exists.

## Viable Shapes

### 1. Contract-first registry

Define `WorkflowSpec` / `WorkflowContract` first, then register first-party and
plugin workflows through a registry.

Correct when:
- workflow identity, aliases, mutation policy, and surfaces must be stable;
- plugins must not hijack first-party names;
- current behavior is already ambiguous enough that inferred contracts would
  encode drift.

Weakness:
- by itself it can become a schema island unless conformance checks compare it
  to actual behavior.

### 2. Registry-first inventory

Make the registry the first visible artifact: canonical ids, aliases, surfaces,
first-party entries, and reserved plugin namespaces.

Correct when:
- the main pain is ambiguous public names such as `pipeline`;
- aliases differ by surface;
- plugin admission and reserved names matter.

Weakness:
- if the registry owns too much before the contract exists, it becomes a config
  store rather than a correctness boundary.

### 3. Flow-first verification

Use Agon Flow as the primary insight source: observe runs, compare outcomes, and
derive reports from telemetry.

Correct when:
- existing telemetry is strong and the goal is runtime truth;
- workflows are highly dynamic;
- you need debugging and operator evidence before making policy decisions.

Weakness:
- flow must not declare the contract. If it does, accidental current behavior
  becomes normative.

### 4. Graph-first workflows

Define `WorkflowGraphSpec`, `ArtifactSpec`, `EdgeSpec`, human gates, and external
adapters as the primary model.

Correct when:
- a real graph executor or visual workflow editor already exists;
- the product is explicitly graph-first;
- composite execution is the immediate runtime surface.

Weakness in this repo:
- the required graph runtime does not exist today. Making it the first
  implementation would be speculative and would distract from the verified
  `pipeline` drift.

### 5. Plugin-first workflow extensions

Design the workflow layer around plugin manifests and registration from the
start.

Correct when:
- third-party workflow packages are the first deliverable;
- plugin sandboxing and lifecycle are already designed;
- first-party workflow ambiguity is solved.

Weakness:
- if first-party contracts are not clean, plugins inherit the confusion.

## Winning Shape

The right shape for this repo is:

**Contract-first + registry authority + conformance reports + Flow verification
+ deferred graph + registry-gated plugins.**

Short form:

1. `WorkflowSpec` declares what a workflow is.
2. `WorkflowRegistry` declares what workflows exist and which aliases/surfaces
   point to them.
3. `WorkflowConformanceReport` compares declarations to current implementation.
4. Agon Flow observes actual runs and verifies them against declarations.
5. `WorkflowGraphSpec` is specified now as a typed future layer, but not the
   first runtime.
6. Plugins enter through the registry and must satisfy the same contracts.

The key authority split:

- Spec declares.
- Registry names and admits.
- Conformance checks declared shape and static drift.
- Flow observes and verifies runtime behavior.
- Graph composes later.
- Dispatch migrates only after conformance proves the current state is visible.

## Layers To Specify Now

### WorkflowSpec

The node-level workflow declaration.

Required fields for the written spec:

```ts
interface WorkflowSpec {
  id: string;
  version: string;
  title: string;
  description?: string;
  sourceKind: 'first-party' | 'plugin' | 'external-adapter';
  archetype: WorkflowArchetype;
  lifecycle: WorkflowLifecycle;
  surfaces: WorkflowSurfaceExposure[];
  aliases: WorkflowAlias[];
  inputs: WorkflowInputSpec[];
  outputs: WorkflowOutputSpec[];
  artifacts: WorkflowArtifactPolicy;
  mutation: WorkflowMutationPolicy;
  authority: WorkflowAuthorityPolicy;
  steps: WorkflowStepSpec[];
  conformance: WorkflowConformancePolicy;
}
```

Important policy fields:

- `surfaces`: CLI command, slash command, MCP tool, plan-mode step, plugin entry,
  or internal-only.
- `aliases`: surface-scoped names, with legacy aliases explicit.
- `mutation`: whether workspace writes are possible, how application happens,
  and whether a human gate is required.
- `authority`: script-owned, agent-owned, human-owned, external-provider-owned,
  or mixed.
- `artifacts`: declared input and output artifact types, including generated
  files and operational state.
- `conformance`: known debt and required checks.

### WorkflowRegistry

The registry owns identity and admission.

Required responsibilities:

- canonical workflow ids;
- surface-scoped aliases;
- reserved first-party aliases such as `pipeline`;
- first-party specs;
- plugin namespace boundaries;
- duplicate alias detection;
- explicit legacy/debt entries.

The registry must not become the execution engine in the first implementation.

### WorkflowConformanceReport

The conformance layer reports whether the declarations match current code and
current exposed surfaces.

Required report fields:

```ts
interface WorkflowConformanceReport {
  generatedAt: string;
  specsChecked: string[];
  findings: WorkflowConformanceFinding[];
  summary: {
    errorCount: number;
    warningCount: number;
    knownDebtCount: number;
  };
}
```

Findings should include severity, code, workflow id, surface, message, and
optional file evidence.

### Agon Flow Verification

Flow is first-class now, but only with the correct authority:

- Telemetry is the observed record.
- Verification compares telemetry to `WorkflowSpec`.
- Flow does not create the contract.

Existing `logFlow`, `readFlows`, and `analyzeFlows` should remain diagnostics.
A future `verifyFlowAgainstWorkflowSpec` can consume `FlowRecord` values and
produce conformance findings.

### WorkflowGraphSpec

Graph is specified now as a typed future layer because workflows will eventually
compose.

It should include:

- `ArtifactSpec`
- `EdgeSpec`
- `HumanGate`
- `ExternalAdapterSpec`
- `WorkflowGraphSpec`

But V1 should not add a graph executor. A graph runtime becomes correct only
after node specs, registry identity, conformance, and flow verification are
working.

### Plugin Admission Contract

Plugins should be able to add workflows later through registry admission.

Required rules:

- plugin workflow ids are namespaced;
- plugins cannot claim reserved first-party aliases without explicit grant;
- mutation policy is required for any workspace-writing workflow;
- external-provider and secret-handling authority must be declared;
- plugin specs must pass the same conformance checks as first-party specs.

## First Implementation Slice

The first implementation should be read-only with respect to dispatch.

Do not route execution through the registry yet. Do not add a graph runtime yet.
Do not load third-party workflow plugins yet.

Implement these first:

```text
packages/core/src/kern/workflows/types.kern
packages/core/src/kern/workflows/specs.kern
packages/core/src/kern/workflows/registry.kern
packages/core/src/kern/workflows/conformance.kern
```

Generated TypeScript should come from the existing KERN compile flow:

```text
packages/core/src/generated/workflows/*.ts
```

Core exports can be added through `packages/core/src/index.ts` after generation.

The first first-party specs should include at least:

- `agon.build-review-fix`
  - slash/in-session `pipeline`
  - build -> fitness -> review/fix
- `agon.brainstorm-forge-tribunal`
  - `agon call pipeline`
  - plan-mode `pipeline`
  - brainstorm -> forge -> tribunal

The legacy public alias `pipeline` should be represented as known surface-scoped
debt, not hidden.

## Staged Implementation Sequence

### Stage 0: Spec artifact

Write the architecture spec and mark the authority split:
Spec declares, registry names, conformance checks, flow verifies, graph composes
later.

Done by this document.

### Stage 1: Core declarations

Add KERN source for:

- workflow type definitions;
- first-party workflow specs;
- registry construction;
- conformance reports.

Tests:

- specs validate;
- duplicate canonical ids fail;
- duplicate aliases fail unless declared as known debt;
- unknown surface names fail;
- mutating workflows require explicit mutation policy;
- generated exports compile.

### Stage 2: First-party drift report

Build a read-only report that compares first-party workflow specs to current
repo surfaces.

Tests:

- the two `pipeline` meanings are both visible;
- `pipeline` alias drift is reported as known debt;
- plan-mode pipeline application behavior can be represented as a conformance
  finding if still divergent.

### Stage 3: Flow verification

Extend the model from static conformance into observed run verification.

Implementation:

- keep `FlowRecord` as observed telemetry;
- add a verifier that can compare `FlowRecord.mode`, `modeMeta`, completion
  state, and expected phase markers to `WorkflowSpec`;
- report mismatch as conformance findings.

Tests:

- a matching sample `FlowRecord` passes;
- missing expected phase metadata warns or fails according to policy;
- a flow for the wrong workflow id fails.

### Stage 4: Plugin admission, still read-only

Add types and validation for plugin-provided workflow specs, but do not execute
plugin workflows yet.

Tests:

- plugin cannot claim reserved alias `pipeline`;
- plugin can register a namespaced workflow id;
- plugin with mutating behavior but no mutation policy fails;
- plugin with external-provider authority must declare it.

### Stage 5: Graph typed layer

Add graph types and serialization tests only after node specs and conformance
are stable.

Tests:

- graph nodes reference valid workflow ids;
- edges reference declared artifact/output names;
- human gates serialize and validate;
- no runtime execution is implied.

### Stage 6: Supervised dispatch migration

Only after the registry and reports are trusted:

- route selected surfaces through registry resolution;
- preserve legacy aliases through explicit compatibility entries;
- use conformance reports as a CI or release gate;
- migrate one surface at a time.

This is the first point where dispatch should depend on the registry.

## Implementation Files

Preferred KERN-first layout:

```text
packages/core/src/kern/workflows/
  types.kern
  specs.kern
  registry.kern
  conformance.kern
  flow-verification.kern      # stage 3
  graph.kern                  # stage 5
  plugins.kern                # stage 4 or 5
```

Generated output:

```text
packages/core/src/generated/workflows/
  types.ts
  specs.ts
  registry.ts
  conformance.ts
  flow-verification.ts
  graph.ts
  plugins.ts
```

Tests:

```text
tests/unit/workflow-spec.test.ts
tests/unit/workflow-registry.test.ts
tests/unit/workflow-conformance.test.ts
tests/unit/workflow-pipeline-drift.test.ts
tests/unit/workflow-flow-verification.test.ts
tests/unit/workflow-plugin-admission.test.ts
tests/unit/workflow-graph-types.test.ts
```

## What Not To Copy

Do not copy Hugging Face Transformers' pipeline runtime/class hierarchy.

Do copy the discipline:

- explicit task identity;
- task-specific component requirements;
- predictable construction;
- separation of declaration from execution;
- clear input/output contracts;
- validation before runtime use.

For Agon, that maps to workflow contracts and conformance, not a universal
pipeline runner.

## Failure Modes To Guard

- Registry becomes a feature-flag/config store instead of identity authority.
- Flow telemetry starts declaring truth instead of verifying declarations.
- GraphSpec becomes a speculative executor before node-level specs exist.
- Dispatch migrates through the registry before reports expose current drift.
- Plugin workflows can hijack first-party aliases.
- A mutating workflow has no mutation policy.
- Generated TypeScript is edited directly while KERN source exists.
- `pipeline` drift is hidden by compatibility naming instead of explicitly
  represented.
- Conformance becomes documentation only and never runs as a test.
- External-provider authority and secret-handling are not declared.

## Team Message

Proposal for review: use a Workflow Architecture Stack, not a universal pipeline
runner.

The winning shape is contract-first plus registry authority, with conformance
reports and Agon Flow verification. Flow is the observed runtime evidence, not
the source of truth. Graph workflows should be specified as the future
composition layer, but not implemented as the first runtime. Plugins should
enter through registry admission so they cannot hijack names like `pipeline` or
silently mutate workspaces.

Main review questions:

1. Are `WorkflowSpec`, `WorkflowRegistry`, and `WorkflowConformanceReport` the
   right first KERN layer?
2. Should `pipeline` be split into `agon.build-review-fix` and
   `agon.brainstorm-forge-tribunal`, with legacy aliases marked as known debt?
3. What fields are missing from mutation, authority, artifact, and plugin
   policies?
4. Should Flow verification be stage 3 exactly, or should we add phase markers
   earlier?
5. What is the smallest graph type set we should reserve now without building a
   graph executor?
