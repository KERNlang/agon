# Thesis Workflow Ecosystem: Pipeline Branch Reread

## Scope

This artifact records a 10-step sequential-thinking reread of the
`analysis/transformers-pipeline-architecture` branch for the ecosystem-level question:

> Can the pipeline branch's contract-first direction eventually support general workflow
> ecosystems like the provided diagram, including chained workflows or multi-workflow graph
> orchestration?

This is not about reproducing the specific thesis workflow. The image is treated as an
example of a general class: artifact-producing workflows connected by typed handoffs,
manual gates, external systems, and build outputs.

## Branch State

- Local repository: `/Users/mrryf/develop/agon_testing/repo`
- Branch: `analysis-transformers`
- Current SHA: `82a3a2d5e88f2e3afde51d2bbe39dedf2157b6e1`
- Diff against `origin/main`: one added file,
  `docs/transformers-pipeline-architecture-analysis.md`

Relevant local files reread or searched:

- `docs/transformers-pipeline-architecture-analysis.md`
- `packages/cli/src/kern/commands/call.kern`
- `packages/cli/src/kern/handlers/pipeline.kern`
- `packages/cli/src/kern/handlers/plan-mode.kern`
- `packages/mcp/src/kern/agon-orchestration.kern`
- generated MCP/intent/router files containing `pipeline`

## Sequential-Thinking Record

1. The branch is an analysis document, not implementation. It supports node-level
   workflow contracts, not full ecosystem graphs yet.
2. Pipeline label drift becomes more dangerous at ecosystem scale because graph edges depend
   on stable artifact, mutation, and apply semantics.
3. `agon call pipeline` and plan-mode `pipeline` are fixed chains
   (`brainstorm -> forge -> tribunal`), not typed graph composition.
4. Plan-mode has steps and `dependsOn`/`imports`/`exports` concepts in surrounding schemas,
   making it the closest existing feature to graph orchestration, but not a typed artifact
   graph.
5. Plugin-facing fields in the branch are relevant to ecosystem nodes, but graph support
   needs edge-level complements.
6. Transformers-style expected preflight can extend to graph edges: expected upstream
   artifacts, freshness, lineage, schema compatibility, permissions, and parallel-safe
   preflights.
7. The branch's warning against copying runtime hierarchy argues against starting with a
   monolithic DAG runner.
8. Existing Agon rooms and autonomous modes are coordination surfaces, not declarative
   ecosystem specs.
9. A branch-derived ecosystem roadmap should resolve first-party workflow contract drift
   before defining graph specs or chained execution.
10. Branch conclusion: it points in the right direction for node contracts and surface
    parity, but the missing abstraction is typed edge/graph contracts over multiple
    `WorkflowSpec`s.

## What The Branch Already Supports For Ecosystems

The branch gives useful foundations for ecosystem support:

- canonical workflow IDs
- alias normalization
- central supported-workflow inventory
- declared input and output expectations
- mutation/apply behavior
- output artifact contracts
- supported surfaces
- generated docs
- parity tests
- plugin-facing workflow metadata

Those are the right primitives for **workflow nodes** in a larger graph.

## What Existing Agon Pipeline Provides

Existing `pipeline` behavior provides examples of chained operations:

- `agon call pipeline`: `brainstorm -> forge -> tribunal`
- plan-mode `pipeline`: `runBrainstorm`, then `runForge`, then `runTribunal`
- slash/in-session `/pipeline`: build -> fitness -> review/fix loop through `handlePipeline`

These are useful examples of sequencing, but they are not the ecosystem abstraction needed
for image-like workflows because they lack:

- typed artifacts between stages
- reusable edge contracts
- graph-level lineage
- manual gate modeling
- external system modeling
- graph-level permission checks
- branch/fan-in/fan-out semantics
- cycle/iteration policies
- graph-level conformance reports

## Plan-Mode Relevance

Plan-mode is the closest existing Agon concept to a workflow graph because plan steps can
have dependencies and context import/export behavior. However, current plan-mode routing is
still mode-oriented. It does not yet provide a durable, declarative graph spec where each
edge declares artifact type, freshness, authority, mutation, and validation rules.

For ecosystem support, plan-mode concepts could inform execution later, but the next
architectural artifact should be declarative:

```text
WorkflowSpec       # single node
WorkflowGraphSpec  # nodes + typed edges + gates + external systems
```

## Branch-Derived Roadmap For Ecosystem Support

1. Fix or explicitly split current first-party `pipeline` semantics.
2. Define and validate `WorkflowSpec` for individual workflows.
3. Add read-only conformance reports for workflow nodes.
4. Define `WorkflowGraphSpec` with:
   - node references
   - typed artifact edges
   - manual gates
   - external adapters
   - graph-level permissions
   - lineage/freshness rules
   - concurrency/locking policy
   - cycle/iteration policy
5. Add graph-level conformance tests.
6. Only then consider limited graph execution.

## Bottom Line

The branch goes in the right direction for the ecosystem vision, but only as the first
layer. It can support general workflow ecosystems later if it evolves from:

```text
workflow contract inventory
```

to:

```text
workflow node specs + graph/edge specs + conformance checks
```

It does not yet justify "chain multiple pipelines together" as live automation. The safe
near-term target is a declarative workflow ecosystem map and conformance report.
