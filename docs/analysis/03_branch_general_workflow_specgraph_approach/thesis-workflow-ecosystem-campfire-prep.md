# Thesis Workflow Ecosystem: Agon Campfire Prep

## Purpose

Prepare an Agon `campfire` run with `codex` and `kimi-code` to openly discuss whether a
future contract-first workflow architecture can support **general workflow ecosystems** like
the provided diagram.

This is not about reproducing the specific thesis workflow. The image is used as a concrete
example of a general architecture class: multi-node workflow graphs with artifacts, gates,
external systems, feedback loops, and build outputs.

## Evidence Inputs

- `.codex/evidence/thesis-workflow-ecosystem-general-theory-reread.md`
- `.codex/evidence/thesis-workflow-ecosystem-branch-reread.md`
- `.codex/evidence/thesis-workflow-ecosystem-image-analysis.md`

## Sequential Prep Record

1. Campfire should explore rather than decide.
2. Scope must be explicit: the image is representative, not the implementation target.
3. Ask whether Agon should evolve toward chained pipelines, workflow graph specs,
   plan-mode graph execution, plugin workflow registries, or a hybrid.
4. Evidence baseline: prior theory supports node specs; branch supports contract discipline
   and warns about drift; image shows graph/edge needs.
5. Compare three levels: `WorkflowSpec` nodes, graph/edge specs, and execution orchestration.
6. Discuss artifact type systems and compatibility rules.
7. Discuss external system adapters, especially Zotero-like metadata systems.
8. Discuss human gates and manual authority.
9. Discuss cycles, previous-run awareness, invalidation, and bounded iteration.
10. Compare opaque chained pipelines against explicit workflow-node composition.
11. Discuss implementation phases: ecosystem map, conformance report, visualization/docs,
    dry-run readiness checks, then limited supervised execution.
12. Surface failure modes: ambiguous labels, stale artifacts, path/symlink bypass, hidden
    external state, unbounded loops, wrong metadata, concurrent writes, and human-judgment
    over-automation.
13. Identify reusable Agon concepts: plan steps, dependencies/imports/exports, rooms,
    goal/conquer, MCP schemas, generated docs, and orchestration modes.
14. Ask Kimi to challenge overengineering and whether graph specs should wait until node
    contracts and plan-mode parity are fixed.
15. Campfire deliverable: exploratory notes, options, disagreements, open questions, and a
    staged roadmap, not a final decision.

## Prompt For Agon Campfire

Discuss whether the contract-first workflow/pipeline architecture can eventually support
general workflow ecosystems like the provided thesis-workflow diagram.

Use these evidence files:

- `/Users/mrryf/develop/agon_testing/.codex/evidence/thesis-workflow-ecosystem-general-theory-reread.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/thesis-workflow-ecosystem-branch-reread.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/thesis-workflow-ecosystem-image-analysis.md`

Important scope:

- Do not try to reproduce the specific thesis workflow.
- Treat the image as a representative example of general workflow ecosystems.
- The question is whether future Agon workflow architecture could support systems with
  multiple workflow nodes, typed artifacts, external adapters, human gates, feedback loops,
  and final build outputs.

Discuss:

1. Is "chain multiple pipelines" the right mental model, or should this become
   `WorkflowGraphSpec` over `WorkflowSpec` nodes?
2. What does the branch already provide for this vision?
3. What is missing: edge contracts, artifact type systems, external adapters, human gates,
   cycles, permissions, graph conformance, execution?
4. What existing Agon concepts could be reused?
5. What are the main failure modes and overengineering risks?
6. What would a staged roadmap look like from read-only ecosystem maps to supervised graph
   execution?

Kimi is an equal participant. Consider its caution seriously. Do not blindly accept either
engine.
