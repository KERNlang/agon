# Thesis Workflow Ecosystem: Agon Synthesis Evidence

## Run Metadata

- Mode: `agon synthesis`
- Run path: `/Users/mrryf/.agon/runs/synthesis-1782422651060-mlc943-thesis-workflow-ecosystem-synthe`
- Command shape: `agon synthesis <prompt> -e codex,kimi-code --swaps=1 --timeout=900 --label thesis-workflow-ecosystem-synthesis --quiet`
- Engines: `codex`, `kimi-code`
- Status: `2/2 succeeded`
- Agon summary: `2/2 drafted; winner=codex`
- Run start: `2026-06-25T21:24:11.059Z`
- Run end: `2026-06-25T21:29:15.998Z`

The run was launched with escalation because Agon writes run artifacts under
`/Users/mrryf/.agon/runs`.

## Output Caveat

Agon `status.json` marks `codex` as the winner, but `codex-output.txt` contains only:

```text
current changes

No reviewable code changes were found because /Users/mrryf/develop/bp is not a Git repository and no staged, unstaged, or untracked diff could be inspected.
```

That is not a usable architecture synthesis. `kimi-code-output.txt` contains the substantive
architecture recommendation. This evidence file therefore treats the run as successful at
the engine/session level but uses Kimi's artifact as the meaningful synthesis output, with
the winner mismatch recorded explicitly.

## Source Inputs

- `.codex/evidence/thesis-workflow-ecosystem-general-theory-reread.md`
- `.codex/evidence/thesis-workflow-ecosystem-branch-reread.md`
- `.codex/evidence/thesis-workflow-ecosystem-image-analysis.md`
- `.codex/evidence/thesis-workflow-ecosystem-campfire-evidence.md`
- `.codex/evidence/thesis-workflow-ecosystem-brainstorm-evidence.md`
- `.codex/evidence/thesis-workflow-ecosystem-synthesis-prep.md`

## Final Verdict

Conditional yes.

The pipeline branch direction can support general workflow ecosystems in the future, but
only if it evolves beyond node-level workflow contracts. The current branch is a foundation
for declaring and testing individual workflows. It is not yet an ecosystem orchestration
system.

The target should not be "chain multiple pipelines together" as opaque commands. The target
should be:

```text
WorkflowSpec        # node contract
WorkflowGraphSpec   # graph/edge/gate contract
ConformanceReport   # read-only proof before execution
```

## Correct Mental Model

The correct mental model is:

```text
graph-of-workflows
```

not:

```text
chain-of-pipelines
```

A linear pipeline is a valid degenerate case only when the flow is strictly linear, has no
human gates, no fan-in/fan-out, no external stateful systems, no cycles, idempotent
artifacts, low stale-artifact risk, and no cross-permission boundaries.

The diagram-like ecosystem violates most of those constraints, so it needs a graph model.

## Recommended Architecture Stack

Preferred terminology:

| Concept | Term | Purpose |
| --- | --- | --- |
| Single declared workflow | `WorkflowSpec` | Node contract: inputs, outputs, phases, mutation policy, authority, surfaces, conformance tests. |
| Typed artifact class | `ArtifactSpec` | Schema, lineage, mutation expectations, freshness rules, canonical storage root. |
| Connection between nodes | `EdgeSpec` | Source/target ports, artifact compatibility, gates, triggers, authority. |
| External system participation | `ExternalAdapterSpec` | API contract, permission scope, read/write policy, reproducibility contract. |
| Full ecosystem declaration | `WorkflowGraphSpec` | Node refs, edge refs, artifact registry, gates, adapters, cycle/fan-in/fan-out/concurrency policies. |
| Safety proof before run | `ConformanceReport` | Verified nodes, edges, unsafe edges, stale artifacts, adapter permissions, cycle policy. |
| Human decision point | `HumanGate` | Explicit approval, review, or authorial decision with policy and authority. |

The graph layer should remain thin. It should reference `WorkflowSpec` and `ArtifactSpec`
rather than redeclaring node internals.

## What The Branch Supports

The branch already supports the direction by emphasizing:

- canonical workflow IDs
- central supported-workflow inventory
- alias normalization
- declared input and output expectations
- explicit mutation/apply behavior
- output artifact contracts
- supported surfaces and generated docs
- parity/conformance tests
- warning against copying heavy runtime hierarchy

These are exactly the node-level contracts a graph layer would reference.

## What Is Missing

Ecosystem support still needs:

- graph identity and versioning
- node inventory with `WorkflowSpec` refs
- edge inventory
- artifact type registry
- lineage propagation
- trigger policies
- manual approval gates
- external system adapter contracts
- permission/capability policy per edge
- fan-in and fan-out rules
- cycle/iteration rules
- concurrency and locking
- stale artifact handling
- graph-level conformance tests
- visualization/docs generation

## Minimal Viable Ecosystem Support

The MVP should be read-only and inspectable.

It should:

1. Load declared `WorkflowSpec`s.
2. Generate a workflow node inventory.
3. Build an artifact type registry from declared inputs/outputs.
4. Infer possible `EdgeSpec`s from compatible outputs and inputs.
5. Allow manual edge annotations where inference is insufficient.
6. List external systems and required `ExternalAdapterSpec`s.
7. Identify human gates and human-authored artifacts.
8. Flag unsafe, unsupported, or ambiguous edges.
9. Detect simple cycles and report them by policy.
10. Produce a `ConformanceReport`.
11. Generate a graph map for inspection.

The MVP output is a report/map, not an executed workflow.

## Staged Roadmap

### Stage 0: Stabilize Node Contracts

- Resolve first-party `pipeline` label drift.
- Lock `WorkflowSpec` fields and conformance tests.
- Ensure every workflow declares inputs, outputs, mutation behavior, and supported surfaces.

### Stage 1: Read-Only Graph Maps

- Introduce `WorkflowGraphSpec` as a thin overlay over `WorkflowSpec` node refs.
- Generate node inventory and artifact registry.
- Infer and allow manual `EdgeSpec` annotations.
- Produce `ConformanceReport`.

### Stage 2: Graph Conformance

- Add edge compatibility checks.
- Add fan-in/fan-out validation.
- Add cycle policy conformance.
- Add manual gate presence checks.

### Stage 3: Artifact Lineage And Freshness

- Propagate lineage from `ArtifactSpec` through `EdgeSpec`.
- Add freshness and invalidation rules.
- Detect stale artifacts and fail closed.

### Stage 4: Dry-Run Readiness

- Simulate graph execution without side effects.
- Validate adapter permissions.
- Validate authority boundaries and root canonicalization.

### Stage 5: Supervised Single-Edge Execution

- Execute one `EdgeSpec` at a time with explicit approval.
- Verify artifact production/consumption.

### Stage 6: Small Subgraph Execution

- Execute small DAGs with manual breakpoints.
- Enforce gate approvals and adapter permissions.

### Stage 7: Bounded Cycles

- Introduce checkpointing and observability.
- Allow bounded feedback loops with explicit stop conditions.

### Stage 8: Supervised Whole-Graph Execution

- Execute full graphs under human supervision.
- Require full lineage, rollback/compensation planning, and audit logging.

### Stage 9: Autonomous Execution

- Future/optional only after earlier stages are proven.

## Conformance Tests

Graph-level tests should verify:

- node references resolve to declared `WorkflowSpec` IDs/versions/aliases
- source output artifact type matches target input artifact type/schema
- unsupported edges are flagged
- fan-in/fan-out rules are explicit
- cycles are declared, bounded, and stopped
- manual gates exist where required
- external writes are covered by `ExternalAdapterSpec`
- stale upstream artifacts invalidate downstream readiness
- lineage metadata propagates along edges
- path canonicalization and root matching are enforced
- no implicit cross-workflow invocation occurs
- mutation behavior matches declarations
- build nodes have deterministic input manifests
- CLI, MCP, plan-mode, and docs stay consistent where supported

## Failure Modes And Mitigations

| Failure Mode | Mitigation |
| --- | --- |
| `pipeline` label drift | Split or explicitly scope overloaded meanings before graph work. |
| Implicit cross-workflow invocation | Require an explicit `EdgeSpec` for every artifact flow. |
| Hidden mutation through shared roots | Declare all writes in `WorkflowSpec` and `ArtifactSpec`; canonicalize paths. |
| Unversioned shared state | Version graph specs, node refs, artifacts, and adapters. |
| Missing lineage | Make lineage propagation mandatory. |
| Cyclic auto-advance | Require bounded cycle policy and stop conditions. |
| External API writes without permission contracts | Require `ExternalAdapterSpec` with scoped permissions. |
| Stale/missing upstream artifacts | Fail closed by default. |
| Non-reproducible build output | Require deterministic manifests for build nodes. |
| Graph map drift | Generate node inventory from `WorkflowSpec`s and flag manual annotation drift. |
| Overengineered graph language | Keep `WorkflowGraphSpec` thin and reuse node contracts. |
| Simple chains over-modeled | Allow simple chains to stay simple when topology does not require graph machinery. |

## What To Avoid

- Do not reproduce the specific thesis workflow.
- Do not start with whole-graph autorun.
- Do not use `pipeline` as the public umbrella term.
- Do not build hidden chaining through side-channel scripts or shared directories.
- Do not allow Turing-complete loops in the first version.
- Do not create engine-specific graph dialects.
- Do not allow external writes without adapter contracts.
- Do not duplicate node semantics inside the graph layer.
- Do not treat manual gates as undocumented pauses.

## Remaining Caveats

- The branch is analysis, not implementation.
- Existing `agon call pipeline` and plan-mode `pipeline` are fixed chains, not graph
  composition.
- Plan-mode can inform execution later, but should not replace `WorkflowGraphSpec`.
- Human gates and external adapters are the hardest parts.
- Cycles require checkpointing, lineage, and observability before they are safe.
- The central design risk is keeping the graph layer thin enough to avoid a second workflow
  language while explicit enough to prevent hidden behavior.

## Bottom Line

General workflow ecosystems like the image are plausible future territory for the pipeline
branch, but the enabling architecture is:

```text
node contracts + thin graph layer + read-only conformance first
```

not:

```text
chain more pipelines
```

The next concrete architecture step should be a read-only `WorkflowGraphSpec`/
`ConformanceReport` prototype over existing `WorkflowSpec`-style nodes, before any live
multi-workflow execution.
