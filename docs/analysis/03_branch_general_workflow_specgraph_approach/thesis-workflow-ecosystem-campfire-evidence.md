# Thesis Workflow Ecosystem: Agon Campfire Evidence

## Run Metadata

- Mode: `agon campfire`
- Run path: `/Users/mrryf/.agon/runs/campfire-1782421857034-8xhy76-thesis-workflow-ecosystem-campfi`
- Command shape: `agon campfire <topic> -e codex,kimi-code --strategy=all-respond --timeout=900 --label thesis-workflow-ecosystem-campfire --quiet`
- Engines: `codex`, `kimi-code`
- Status: `2/2 succeeded`
- Agon summary: `2/2 engines contributed`
- First attempt: sandbox denied writing to `/Users/mrryf/.agon/runs/...`
- Successful attempt: rerun with escalation for Agon's normal run-artifact directory

## Source Inputs

The Campfire prompt pointed to:

- `.codex/evidence/thesis-workflow-ecosystem-general-theory-reread.md`
- `.codex/evidence/thesis-workflow-ecosystem-branch-reread.md`
- `.codex/evidence/thesis-workflow-ecosystem-image-analysis.md`

## Evidence Access Caveat

Codex grounded its response in the three evidence files.

Kimi contributed, but its output says its Read tool errored on the evidence paths and its
Bash verification was rejected. Therefore Kimi's contribution should be treated as an
architecture-caution response grounded in the prompt framing, not a direct reading of the
evidence files.

This limitation does not invalidate the run, but it matters for weighting: Kimi is an equal
participant, but not equally source-grounded in this Campfire artifact.

## Codex Contribution

Codex's main position:

- The contract-first architecture can plausibly grow into general workflow ecosystems.
- Current `WorkflowSpec` is a node-level primitive, not the whole architecture.
- "Chain multiple pipelines" is an imprecise folk phrase; it hides typed handoffs,
  stale artifacts, fan-in/fan-out, approval gates, external writes, retries, cycles,
  lineage, and authority.
- A better model is `WorkflowGraphSpec` over `WorkflowSpec` nodes.

Codex identified missing graph semantics:

- artifact type registry
- lineage propagation
- graph conformance reports
- manual gate modeling
- external adapter contracts
- cycle/iteration limits
- fan-in/fan-out rules
- concurrency policy
- fail-closed behavior for stale or missing upstream material

Codex's staged roadmap:

1. Read-only ecosystem maps.
2. Graph-level conformance reports with no execution.
3. Typed artifact compatibility and lineage checks.
4. Supervised dry-runs and gated execution of single edges.
5. Limited graph execution with human approvals and strict cycle limits.

## Kimi Contribution

Kimi agreed with the high-level direction:

- A thesis-like workflow ecosystem is a graph, not a line.
- Flattening the graph into chained pipelines pushes complexity into implicit glue scripts
  and side-channel state.
- `WorkflowGraphSpec` over `WorkflowSpec` nodes is closer to the problem because topology,
  edge contracts, cycles, and human gates become first-class.

Kimi's main caution:

- Avoid overengineering a parallel graph contract language.
- Keep the graph layer thin and delegate as much as possible to existing node contracts.
- Reuse existing contract primitives for node interfaces.
- Start read-only and let users inspect/validate ecosystem maps before execution.

Kimi's failure modes:

- turning every simple chain into a graph
- non-terminating feedback loops
- shared state that makes cycles non-reproducible
- human gates that still require out-of-band authorization
- ecosystem maps becoming a second source of truth that drifts from real execution

Kimi's roadmap:

1. Generate an ecosystem map from declared or running workflows.
2. Let users inspect and validate it without execution.
3. Support supervised execution of small subgraphs with explicit breakpoints.
4. Only later allow full graph execution after provenance, rollback, and cycle gating are
   solid.

## Agreements

Both engines agreed:

- The right long-term mental model is graph-of-workflows, not chain-of-pipelines.
- `WorkflowSpec` remains useful as the node contract.
- A graph-level layer is needed for typed edges, artifact compatibility, human gates,
  external adapters, cycles, and graph conformance.
- Execution should not be the first implementation step.
- The first step should be read-only ecosystem mapping and conformance.
- Human gates must be first-class, not accidental automation breaks.

## Open Tensions

- How thick should the graph layer be?
  - Codex emphasizes the missing graph semantics.
  - Kimi emphasizes keeping the graph layer thin and avoiding a parallel abstraction system.
- Should graph specs be authored manually, generated from node specs, or both?
- How much of existing plan-mode can be reused before defining a new `WorkflowGraphSpec`?
- When does a simple chain deserve graph machinery?

## Campfire Takeaway

The Campfire supports the ecosystem vision under a conservative interpretation:

```text
WorkflowSpec       = node contract
WorkflowGraphSpec  = thin graph/edge/gate layer over node contracts
ConformanceReport  = read-only proof before execution
```

The branch can be a foundation, but only after first-party workflow contract drift is fixed
and the graph layer is introduced as a read-only, inspectable map before any live execution.
