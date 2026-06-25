# Agon Brainstorm Prep

Date: 2026-06-25

Purpose: prepare the Agon brainstorm requested by the user, using insights from:

- `.codex/evidence/transformers-pipeline-architecture-branch-analysis.md`
- `.codex/evidence/chapter-source-auditor-skill-analysis.md`

## Sequential Prep Record

1. Use the two evidence files as the grounding basis.
2. Ask whether a Transformers-style workflow contract table is the right abstraction for programmatic registry invocation.
3. Force a distinction between metadata registry and runtime pipeline/factory.
4. Surface the risk that "pipeline" implies unsafe auto-progression.
5. Include deterministic helper scripts as possible preflight/checker hooks.
6. Test safer canonical IDs at block level rather than one generic pipeline ID.
7. Separate required-now contract fields from plugin-future fields.
8. Ask for parity-test strategy across registry and Agon surfaces.
9. Ask what would make the abstraction wrong.
10. Request a ranked recommendation and smallest safe implementation slice.

## Prompt

We are evaluating whether Agon's Transformers-inspired workflow contract idea can make the phase-gated `chapter-source-auditor` skill available in a registry with canonical IDs and programmatic invocation.

Grounding evidence:

- The `analysis/transformers-pipeline-architecture` branch changes one analysis doc. Its useful takeaway is not to copy Hugging Face's ML runtime/class hierarchy, but to copy contract discipline: canonical workflow IDs, aliases, supported-workflow inventory, input/output contracts, mutation/apply behavior, preflight expectations, artifacts, and parity tests.
- Local Agon verification shows `pipeline` currently means different things depending on surface:
  - slash `/pipeline`, in-session Cesar routing, and in-session MCP `Pipeline` route to a build -> review -> fix handler;
  - `agon call pipeline`, MCP direct `Pipeline`, and plan-mode `pipeline` run a brainstorm -> forge -> tribunal chain;
  - plan-mode `pipeline` calls `runForge` but does not apply the winner to `cwd`, unlike plan-mode `forge` and `teamforge`.
- Agon already has fragmented metadata: slash command registry, MCP tool schemas, core tool definitions, plan step types, and mode-name lists. There is no single workflow contract table.
- The `chapter-source-auditor` skill is explicit-only and phase-gated:
  - Block 1 catalogs scope, reads thesis/raw sources, builds passage inventory, atomic claims, source-support units, ledgers, indexes, and manifests. It creates no findings.
  - Block 2 verifies lineage/freshness, rereads raw sources, adjudicates candidates into governed dispositions, and produces findings/packets only after false-positive/negative controls and authorial-decision gates.
  - Block 3 verifies manual user integration against packets and before/after units. It never edits thesis files.
- The skill writes only generated audit artifacts; thesis Markdown, `_raw` files, protected roots, old regression evidence, and previous-run roots are read-only.
- The skill has deterministic helper scripts for invocation syntax, scope inventory, manifest verification, artifact contract checks, and run indexing. These scripts explicitly do not perform semantic source judgment.

Please brainstorm with Kimi and Codex as equal peers. Do not blindly accept the prior analysis.

Questions:

1. Is a `WorkflowContract`/contract-table abstraction the right vessel to expose this skill through an Agon registry and invoke it programmatically?
2. What would make this abstraction wrong or dangerous?
3. Should the canonical IDs be block-level, e.g. `chapter-source-audit.block1.catalog`, `chapter-source-audit.block2.adjudicate`, `chapter-source-audit.block3.verify-integration`, with an optional wrapper, or one monolithic `chapter-source-audit.pipeline`?
4. Which contract fields are required for the first safe implementation slice?
5. Which fields should wait until plugin registration is real?
6. How should mutation/apply behavior be represented so the skill cannot accidentally edit thesis/raw files or auto-progress across blocks?
7. How should deterministic preflight/checker scripts be exposed without implying semantic validation?
8. What parity tests should be written first?
9. What is the smallest safe implementation slice?

Return a concise but rigorous recommendation, including risks, objections, and a proposed first slice.
