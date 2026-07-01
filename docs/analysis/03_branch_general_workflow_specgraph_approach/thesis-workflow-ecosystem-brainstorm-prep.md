# Thesis Workflow Ecosystem: Agon Brainstorm Prep

## Purpose

Prepare an Agon `brainstorm` run with `codex` and `kimi-code` to generate architecture
options for enabling general workflow ecosystems like the provided image.

This follows the Campfire discussion and asks for concrete options, rankings, failure modes,
and a staged path. It is still not about reproducing the specific thesis workflow.

## Evidence Inputs

- `.codex/evidence/thesis-workflow-ecosystem-general-theory-reread.md`
- `.codex/evidence/thesis-workflow-ecosystem-branch-reread.md`
- `.codex/evidence/thesis-workflow-ecosystem-image-analysis.md`
- `.codex/evidence/thesis-workflow-ecosystem-campfire-evidence.md`

## Sequential Prep Record

1. Brainstorm should transform Campfire's exploratory agreement into concrete architecture
   options.
2. Treat Kimi's Campfire evidence-access limitation as context, but still consider its
   architectural caution.
3. Ask for multiple future shapes: simple chain composition, `WorkflowGraphSpec`,
   plan-mode-backed execution, plugin ecosystem manifests, or adapter-centered artifact bus.
4. Rank options by safety, implementation cost, branch fit, and support for general ecosystems.
5. Distinguish specification, conformance, dry-run, and execution.
6. Ask for graph primitives: node refs, artifact specs, edge specs, external adapter specs,
   human gates, cycles, triggers, permissions, lineage, invalidation, and tests.
7. Ask for minimal viable ecosystem support: likely read-only graph inventory plus manual edge
   annotations and conformance reporting.
8. Identify reusable Agon concepts: plan dependencies/imports/exports, MCP schemas, rooms,
   generated docs, run artifacts, and goal/conquer gates.
9. Name non-goals: reproducing the thesis workflow, auto-running whole graphs, hidden pipeline
   chaining, public `pipeline` umbrella, and graph maps as a second source of truth.
10. Ask for failure modes: stale artifacts, schema drift, path canonicalization, adapter
    idempotency, credential leakage, concurrent writes, and unbounded cycles.
11. Ask how to represent human gates and human-authored artifacts.
12. Ask for graph conformance tests.
13. Ask for the immediate implementation slice.
14. Invite disagreement on graph-layer thickness.
15. Deliverable: ranked option set plus staged path and caveats.

## Prompt For Agon Brainstorm

Brainstorm future architecture options for enabling **general workflow ecosystems** like the
provided workflow image.

Use these evidence files:

- `/Users/mrryf/develop/agon_testing/.codex/evidence/thesis-workflow-ecosystem-general-theory-reread.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/thesis-workflow-ecosystem-branch-reread.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/thesis-workflow-ecosystem-image-analysis.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/thesis-workflow-ecosystem-campfire-evidence.md`

Scope:

- Do not reproduce the thesis workflow.
- Treat the diagram as an example of a general class of systems.
- We are exploring whether future Agon workflow architecture can enable workflow ecosystems
  with multiple nodes, typed artifacts, external adapters, human gates, feedback loops, and
  build outputs.

Please produce:

1. A ranked set of architecture options.
2. Tradeoffs for each option.
3. Whether "chain multiple pipelines" is ever sufficient, and where it breaks.
4. Whether `WorkflowGraphSpec` over `WorkflowSpec` nodes is the right direction.
5. What graph primitives are required.
6. What existing Agon concepts can be reused.
7. What should be explicit non-goals.
8. Failure modes and mitigations.
9. Minimal viable ecosystem support.
10. A staged roadmap from read-only graph maps to supervised graph execution.

Kimi is an equal participant. Consider its caution seriously. Do not blindly accept either
engine.
