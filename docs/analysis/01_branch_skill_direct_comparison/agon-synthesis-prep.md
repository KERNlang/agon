# Agon Synthesis Prep: chapter-source-auditor Workflow Contract Decision

## Purpose

Prepare the Agon `synthesis` run with Kimi and Codex by combining:

- `.codex/evidence/transformers-pipeline-architecture-branch-analysis.md`
- `.codex/evidence/chapter-source-auditor-skill-analysis.md`
- `.codex/evidence/agon-brainstorm-evidence.md`

The synthesis target is a decision-grade answer: can the phase-gated
`chapter-source-auditor` skill become a registry-invokable Agon workflow pipeline, and
what is the smallest safe implementation slice?

## Sequential Prep Notes

1. The synthesis should be a decision artifact, not another broad analysis pass. It must
   decide whether the skill can become a registry-invokable workflow family and how to
   avoid Agon's existing `pipeline` ambiguity.
2. The branch analysis supports copying contract discipline from Transformers-style
   pipelines, not copying the ML runtime hierarchy or class model.
3. Agon's current `pipeline` term is overloaded across slash, call, MCP direct, MCP
   in-session, and plan-mode. A workflow registry must reduce that ambiguity.
4. The `chapter-source-auditor` skill is already contract-shaped: explicit invocation,
   one block per run, local evidence only, generated-artifact-only writes, and mandatory
   stop/next-invocation behavior.
5. The three blocks are semantically distinct workflows:
   - Block 1 catalogs and establishes source-reading basis.
   - Block 2 adjudicates findings with lineage, freshness, and false-positive controls.
   - Block 3 verifies manual integration and never edits thesis text.
6. The brainstorm showed a useful split: Kimi emphasized safety and pipeline-drift
   resolution, while Codex emphasized discoverability. The synthesis should keep both by
   using executable phase-level contracts plus a non-executing wrapper.
7. A `WorkflowContract` table is acceptable only if it includes safety semantics, not just
   display metadata. Required fields include explicit invocation, no auto-advance,
   mutation/apply behavior, evidence policy, protected roots, parent artifact requirements,
   freshness policy, checker status namespace, and supported surfaces.
8. Deterministic scripts should be represented as structural preflight/checker hooks. They
   cannot issue semantic source-truth verdicts.
9. The smallest safe slice should avoid broad plugin machinery: register Block 1, add a
   discovery wrapper, normalize/reject invocation selectors, declare read/write policy,
   expose structural hooks, and add parity tests.
10. Synthesis hypothesis: yes, the skill can be made registry-invokable as a workflow
    family, but the first implementation should be a metadata-first
    `chapter-source-audit.block1.catalog` contract plus a non-executing wrapper.

## Prompt For Agon Synthesis

Using the branch analysis, skill analysis, and brainstorm evidence in `.codex/evidence`,
synthesize a final architecture recommendation for making `chapter-source-auditor`
available through an Agon workflow registry. Treat Kimi and Codex as equal synthesis
participants. Do not blindly accept either agent or the brainstorm winner. Answer:

1. Is `WorkflowContract` the right abstraction, and with what constraints?
2. Should the skill be one pipeline, three phase-level workflows, or a wrapper plus phases?
3. What exact contract fields are needed for this skill?
4. How should deterministic scripts and semantic authority be represented?
5. What existing Agon pipeline routing ambiguity must be fixed or isolated first?
6. What is the smallest safe implementation slice?
7. What parity tests should guard the design?

The desired output is concise but specific enough to guide implementation.
