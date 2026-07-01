# General Workflow Theory: Agon Synthesis Prep

## Purpose

Prepare an Agon `synthesis` run with `kimi-code` and `codex` to produce a final,
decision-grade answer on the general workflow theory claim.

Primary evidence:

- `.codex/evidence/general-workflow-theory-branch-analysis.md`
- `.codex/evidence/general-workflow-theory-skill-corpus-analysis.md`
- `.codex/evidence/general-workflow-theory-brainstorm-evidence.md`

## Sequential Prep Record

1. The synthesis should produce a final verdict on the general theory, not just an
   implementation spec.
2. The branch proves contract-first direction and pipeline drift risk; the skill corpus
   validates multiple archetypes; the brainstorm supports core schema plus typed extensions.
3. The correct claim is "contract-first workflow registry generalizes to declared workflow
   skills," not "pipeline runtime generalizes to all skills."
4. The core schema must stay testable: identity, invocation policy, phase model, inputs,
   artifacts, read/write/mutation policy, deterministic hooks, authority boundary, stop/next
   rules, surfaces, and tests.
5. Extensions should be typed by archetype: semantic audit, structural coherence, citation
   verification, checker-authoritative validation, and ingest/conversion.
6. `knowledge-pipeline` and `orthogram-inquisitor` are the key corrections: state inference,
   generated-domain-output writes, and script-owned gate/status authority must be policy
   fields.
7. Anti-archetypes matter: skills without stable invocation, artifacts, mutation declarations,
   or testable aliases should not enter the registry.
8. The smallest safe implementation is read-only contract inventory plus conformance checker,
   not live invocation or plugin execution.
9. The synthesis should include caveats: local corpus only, schema versioning, avoid
   `pipeline` as a public term, and unresolved concurrency/locking.
10. Hypothesis: the general theory is sound with constraints.

## Prompt For Agon Synthesis

Use the following evidence files:

- `/Users/mrryf/develop/agon_testing/.codex/evidence/general-workflow-theory-branch-analysis.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/general-workflow-theory-skill-corpus-analysis.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/general-workflow-theory-brainstorm-evidence.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/general-workflow-theory-synthesis-prep.md`

Synthesize a final architecture decision on the claim:

> The contract-first workflow/pipeline idea generalizes beyond `chapter-source-auditor` to
> other phase-gated, artifact-producing skills.

Treat Kimi and Codex as equal synthesis participants. Do not blindly accept either agent or
the brainstorm winner. Produce a concise but decision-grade recommendation that answers:

1. What exact version of the general claim is valid?
2. What overclaim should be rejected?
3. Is `WorkflowContract`/`WorkflowSpec` the right abstraction?
4. What belongs in the strict core schema?
5. What belongs in typed archetype extensions?
6. How should `knowledge-pipeline` and `orthogram-inquisitor` be handled?
7. What archetypes and anti-archetypes should be named?
8. Should `pipeline` be avoided as the public registry term?
9. What is the smallest safe implementation slice?
10. What conformance/parity tests would validate the theory?
11. What caveats remain?
