# Thesis Workflow Ecosystem: Agon Brainstorm Evidence

## Run Metadata

- Mode: `agon brainstorm`
- Run path: `/Users/mrryf/.agon/runs/brainstorm-1782422195381-c7w5tu-thesis-workflow-ecosystem-brains`
- Command shape: `agon brainstorm <prompt> -e codex,kimi-code --timeout=900 --label thesis-workflow-ecosystem-brainstorm --quiet`
- Engines: `codex`, `kimi-code`
- Status: `2/2 succeeded`
- Agon summary: `2/2 bid; winner=codex`
- Confidence bids:
  - `codex`: `confidence=92`
  - `kimi-code`: `confidence=27`

The run was launched with escalation because Agon writes normal run artifacts under
`/Users/mrryf/.agon/runs`.

## Source Inputs

- `.codex/evidence/thesis-workflow-ecosystem-general-theory-reread.md`
- `.codex/evidence/thesis-workflow-ecosystem-branch-reread.md`
- `.codex/evidence/thesis-workflow-ecosystem-image-analysis.md`
- `.codex/evidence/thesis-workflow-ecosystem-campfire-evidence.md`
- `.codex/evidence/thesis-workflow-ecosystem-brainstorm-prep.md`

## Codex Position

Codex recommended:

```text
Thin WorkflowGraphSpec over existing WorkflowSpec nodes, introduced read-only first.
```

Codex ranked the options:

1. Thin `WorkflowGraphSpec` over `WorkflowSpec` nodes.
2. Read-only ecosystem inventory and conformance reports.
3. Plan-mode-backed supervised subgraph execution.
4. Plugin ecosystem manifests and generated docs.
5. Adapter-centered artifact bus.
6. Raw chained pipelines.

Codex's key distinction:

- Chaining pipelines is enough only for simple linear flows with no human gates, no fan-in,
  no fan-out, no external stateful writes, no cycles, no stale-artifact risk, and no
  cross-permission boundaries.
- Image-like ecosystems break chaining because they require typed artifacts, fan-in/fan-out,
  external systems, human approval, proposal/apply/verify separation, cycles, and lineage.

Codex proposed this architecture stack:

```text
WorkflowSpec        # node contract
ArtifactSpec        # artifact type, schema, lineage, mutation expectations
EdgeSpec            # compatibility, freshness, authority, gate, trigger
ExternalAdapterSpec # external system/API contract
WorkflowGraphSpec   # graph topology and policies
ConformanceReport   # proof of inspectability/safety before execution
```

Codex's minimum viable ecosystem support is read-only:

1. Load declared `WorkflowSpec`s.
2. Generate a workflow node inventory.
3. Infer possible artifact edges from outputs and inputs.
4. Allow manual edge annotations.
5. List artifact types, schemas, roots, versions, and producers.
6. List external systems and adapters.
7. Mark human gates and human-authored artifacts.
8. Report unsupported or unsafe edges.
9. Produce a `ConformanceReport`.
10. Generate a graph map for inspection.

## Kimi Position

Kimi recommended a staged graph overlay above existing `WorkflowSpec` nodes.

Kimi ranked architecture options:

1. DAG overlay on `WorkflowSpec` `NodeRef`s.
2. Native `WorkflowGraphSpec` with inline nodes.
3. Per-engine graph dialects.

Kimi recommended option 1 for MVP, option 2 only for ecosystem scale, and rejected
per-engine graph dialects.

Kimi's suggested graph primitives:

- `NodeRef`
- typed `Edge` variants: `control`, `data`, `conditional`
- `SubGraph` composite
- `Gateway` variants: `fork`, `join`
- `EngineSlot`
- typed ports for data flow

Kimi's line on chaining:

- Chains are sufficient for linear sequences and independent fan-out.
- Chains break at joins, cycles, recursive subgraphs, and conditional routing on upstream
  state.

Kimi's explicit non-goals:

- no Turing-complete loops in V1
- no cross-run persistent graph state in V1
- no engine-specific graph extensions
- no unsupervised autonomous cycles

Kimi's roadmap:

1. Read-only graph maps and linter.
2. Deterministic DAG execution through existing pipeline/plan concepts.
3. Conditional gateways with human-gated joins.
4. Optional bounded cycles with checkpointing and full observability.

## Agreements

Both engines agreed:

- The long-term target should be graph-of-workflows, not opaque chain-of-pipelines.
- `WorkflowSpec` should remain the node-level contract.
- The first implementation should be read-only and conformance-oriented.
- Execution should be staged and supervised.
- Human gates, external systems, typed artifacts, and cycles must be explicit.
- The graph layer should not be engine-specific.

## Tensions

- Codex emphasizes a full typed artifact/edge/adapter stack.
- Kimi emphasizes a minimal graph overlay and warns against a new parallel workflow language.
- Codex treats raw chained pipelines as the lowest-ranked option.
- Kimi sees deterministic DAG execution through existing pipeline/plan concepts as a possible
  stage 2 after read-only graph maps.

## Brainstorm Takeaway

The brainstorm strengthens the architecture direction:

```text
WorkflowSpec nodes first
WorkflowGraphSpec / graph overlay second
read-only conformance before execution
supervised subgraph execution before whole-graph execution
bounded cycles only after checkpointing and observability exist
```

For general workflow ecosystems like the image, the viable target is not chaining multiple
pipelines directly. It is a typed graph layer over workflow contracts, kept thin enough to
avoid duplicating node semantics.
