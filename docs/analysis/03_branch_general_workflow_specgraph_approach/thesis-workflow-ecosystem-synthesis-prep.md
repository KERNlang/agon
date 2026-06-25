# Thesis Workflow Ecosystem: Agon Synthesis Prep

## Purpose

Prepare an Agon `synthesis` run with `codex` and `kimi-code` to produce the final
decision-grade recommendation for enabling general workflow ecosystems like the provided
image.

This is not about recreating the image's specific thesis workflow. The image is a
representative example of a general class: multi-node workflow systems with typed artifacts,
external adapters, human gates, feedback loops, and build outputs.

## Evidence Inputs

- `.codex/evidence/thesis-workflow-ecosystem-general-theory-reread.md`
- `.codex/evidence/thesis-workflow-ecosystem-branch-reread.md`
- `.codex/evidence/thesis-workflow-ecosystem-image-analysis.md`
- `.codex/evidence/thesis-workflow-ecosystem-campfire-evidence.md`
- `.codex/evidence/thesis-workflow-ecosystem-brainstorm-evidence.md`

## Sequential Prep Record

1. The final synthesis must answer the ecosystem-enablement question, not rehash the thesis
   workflow.
2. Evidence convergence: `WorkflowSpec` is node-level; ecosystem support requires graph-level
   contracts.
3. The branch supports canonical IDs, aliases, supported inventories, input/output contracts,
   mutation/apply behavior, and parity tests; it does not yet provide graph edges.
4. The image shows why opaque chaining fails: fan-out, fan-in, cycles, human gates, external
   systems, heterogeneous artifacts, and proposal/apply/verify separation.
5. Campfire's guiding constraint: graph-of-workflows, not chain-of-pipelines; thin graph
   layer; read-only first; human gates first-class.
6. Brainstorm's ranked result: thin `WorkflowGraphSpec` over `WorkflowSpec` nodes; read-only
   conformance first; supervised subgraph execution later; raw chained pipelines rank lowest.
7. Terminology should avoid `pipeline` as public umbrella. Use `WorkflowSpec`, `ArtifactSpec`,
   `EdgeSpec`, `ExternalAdapterSpec`, `WorkflowGraphSpec`, and `ConformanceReport`.
8. Simple chaining remains acceptable only for linear, idempotent, no-gate, no-external-state,
   no-fan-in/out flows with low stale-artifact risk.
9. Graph primitives: node refs, artifact specs, edge specs, ports, external adapters, human
   gates, proposal/apply/verify edges, fan-in/fan-out, cycles, triggers, permissions,
   lineage, invalidation, locks, and tests.
10. Reusable Agon concepts: plan-mode dependencies/imports/exports, run artifacts, generated
    docs, MCP schemas, goal/conquer gate discipline, rooms for coordination.
11. Non-goals: exact thesis-workflow reproduction, whole-graph autorun, public `pipeline`
    umbrella, hidden chaining, Turing-complete loops, engine-specific graph dialects,
    external writes without adapters.
12. Read-only MVP: load `WorkflowSpec`s, list nodes/artifacts/external systems/human gates,
    infer possible edges, allow manual edge annotations, flag unsafe edges, produce graph map
    and `ConformanceReport`.
13. Staged roadmap: node contracts, graph maps, graph conformance, artifact/lineage
    validation, dry-run readiness, single-edge execution, small subgraph execution, bounded
    cycles, supervised whole-graph execution.
14. Kimi's caution: keep the graph overlay thin, generate from node contracts where possible,
    avoid a second workflow language, and do not make every simple chain a graph.
15. Codex's graph semantics: artifact type registry, external adapters, conformance reports,
    manual gate modeling, fan-in/fan-out, concurrency policy, fail-closed stale artifacts.
16. Graph conformance tests must verify node refs, edge compatibility, unsupported edges,
    stale invalidation, adapter permissions, bounded cycles, path canonicalization/root
    matching, and no implicit invocation.
17. Avoid graph maps becoming a second source of truth: generate node inventory from
    `WorkflowSpec`s, version refs, make manual edge annotations explicit, and flag drift.
18. The branch can support this someday if it stabilizes workflow contracts and evolves into
    graph/edge specs; it cannot if it only extends the overloaded `pipeline` command.
19. Synthesis should produce a decision-grade recommendation with architecture stack, staged
    roadmap, and caveats.
20. Hypothesis: ecosystem support is plausible, but the next architecture is not "chain
    pipelines"; it is node contracts plus a thin graph layer, starting read-only.

## Prompt For Agon Synthesis

Synthesize a final architecture recommendation for enabling **general workflow ecosystems**
like the provided diagram.

Use these evidence files:

- `/Users/mrryf/develop/agon_testing/.codex/evidence/thesis-workflow-ecosystem-general-theory-reread.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/thesis-workflow-ecosystem-branch-reread.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/thesis-workflow-ecosystem-image-analysis.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/thesis-workflow-ecosystem-campfire-evidence.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/thesis-workflow-ecosystem-brainstorm-evidence.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/thesis-workflow-ecosystem-synthesis-prep.md`

Scope:

- Do not reproduce the specific thesis workflow.
- Treat the image as an example of a general workflow ecosystem class.
- The question is whether future Agon workflow architecture can enable systems with multiple
  workflow nodes, typed artifacts, external adapters, human gates, feedback loops, and final
  build outputs.

Produce:

1. Final verdict: can the pipeline branch direction support general workflow ecosystems?
2. Correct mental model: chained pipelines, graph-of-workflows, plan-mode execution, or other?
3. Recommended architecture stack and terminology.
4. What current branch evidence supports.
5. What is missing for ecosystem support.
6. Minimal viable ecosystem support.
7. Staged roadmap.
8. Conformance/parity tests.
9. Failure modes and mitigations.
10. What to avoid.
11. Remaining caveats.

Treat Kimi and Codex as equal synthesis participants. Consider Kimi's caution seriously, but
do not blindly accept either engine.
