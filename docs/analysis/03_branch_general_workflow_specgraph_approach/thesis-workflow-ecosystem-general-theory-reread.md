# Thesis Workflow Ecosystem: General Theory Reread

## Scope

This artifact records a 10-step sequential-thinking reread of all existing
`general-workflow-theory-*` evidence files for a new, narrower purpose:

> Evaluate whether the contract-first workflow architecture can eventually enable general
> workflow ecosystems like the provided diagram, not reproduce that specific thesis workflow.

Files reread in full:

- `.codex/evidence/general-workflow-theory-branch-analysis.md`
- `.codex/evidence/general-workflow-theory-skill-corpus-analysis.md`
- `.codex/evidence/general-workflow-theory-brainstorm-prep.md`
- `.codex/evidence/general-workflow-theory-brainstorm-evidence.md`
- `.codex/evidence/general-workflow-theory-synthesis-prep.md`
- `.codex/evidence/general-workflow-theory-synthesis-evidence.md`

## Sequential-Thinking Record

1. The prior general theory validates workflow contracts for individual
   registry-invokable skills, not complete workflow ecosystems.
2. Existing strict core fields remain necessary for ecosystem support, but they describe
   graph nodes, not graph edges.
3. Path canonicalization and root matching become more important when many workflows exchange
   artifacts and write into different roots.
4. The archetype model is directly relevant because an ecosystem mixes ingest/conversion,
   semantic audit, structural coherence, checker validation, sync, and build/render nodes.
5. The read-only first slice should become an ecosystem inventory/conformance report:
   workflow nodes, artifact types, possible edges, external systems, manual gates, and unsafe
   or unsupported edges.
6. Ecosystem anti-patterns include fuzzy artifact handoff, implicit cross-workflow invocation,
   hidden mutation, unversioned shared state, missing lineage, cyclic auto-advance, and
   external API writes without permission contracts.
7. A second artifact above `WorkflowSpec` is probably needed: `WorkflowGraphSpec` or
   `EcosystemSpec`.
8. Human authorship and manual gates must be first-class graph nodes or gate policies, not
   accidental interruptions in an automation chain.
9. `pipeline` is even more misleading at ecosystem level because the diagram is a directed
   graph with loops, fan-in/fan-out, side-channel systems, and build outputs.
10. Carry-forward conclusion: prior evidence supports the node-level foundation, but not
    ecosystem orchestration by itself.

## Relevant Existing Evidence

The prior synthesis supports a constrained claim:

> A skill can become a registry-invokable workflow when its invocation behavior, phase or
> step model, inputs, outputs, artifact lineage, mutation policy, authority boundaries,
> deterministic helpers, stop conditions, and supported surfaces can be declared and tested
> as a versioned contract.

This is the right foundation for the image-level vision, but it covers only the **node**
contract. The image-level vision requires additional **edge** and **graph** contracts.

## Node-Level Foundation

The following existing `WorkflowSpec` fields remain relevant:

- `id`
- `version`
- `source_skill`
- `archetype`
- invocation policy
- aliases and normalization/rejection rules
- supported surfaces
- phase/step model
- input schema
- artifact policy
- read policy
- write policy
- mutation behavior
- deterministic hooks and their authority
- authority boundaries
- stop conditions
- preflight requirements
- conformance tests

These fields can describe individual nodes such as:

- research summarization
- metadata sync
- PDF ingestion/conversion
- source audit
- coherence review
- content sync
- build/render

## Missing Ecosystem Layer

A general ecosystem like the diagram needs additional contract dimensions:

- graph identity and version
- node inventory
- edge inventory
- artifact type schemas
- artifact compatibility rules
- lineage propagation
- trigger policy
- manual approval gates
- external system adapters
- permission/capability policy per edge
- fan-in and fan-out rules
- cycle/iteration rules
- concurrency and locking
- stale artifact handling
- graph-level conformance tests
- visualization or docs generation

This suggests a second-level artifact:

```text
WorkflowGraphSpec
```

or:

```text
EcosystemSpec
```

This graph spec would reference individual `WorkflowSpec` nodes rather than replace them.

## Ecosystem Anti-Patterns

The prior anti-archetypes should be extended for graph systems:

- fuzzy artifact handoff
- implicit cross-workflow invocation
- hidden mutation through shared roots
- unversioned shared state
- missing artifact lineage
- cyclic auto-advance
- unbounded retry loops
- external API writes without permission contracts
- build/render steps without reproducible inputs
- manual decisions represented as undocumented pauses

## Implication For The Pipeline Branch

The pipeline branch goes in the right direction as a contract discipline for individual
workflow nodes. It does not yet answer how multiple nodes should be chained, gated,
visualized, retried, or permissioned as a larger ecosystem.

The next architectural step is not a universal pipeline runner. It is a graph-level
contract layer:

```text
WorkflowSpec        # node contract
WorkflowGraphSpec   # ecosystem/edge contract
ConformanceReport   # proof that the graph is safe to inspect or run
```

## Bottom Line

The existing general workflow theory is a plausible foundation for general workflow
ecosystems like the image, but only as the **node contract layer**. Supporting entire
workflow ecosystems requires an additional graph contract layer with typed artifact edges,
manual gates, external adapters, permissions, lineage, and graph-level conformance tests.
