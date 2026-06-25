# General Workflow Theory: Agon Brainstorm Prep

## Purpose

Prepare an Agon `brainstorm` run with `kimi-code` and `codex` to test the broad claim:

> The contract-first workflow/pipeline idea generalizes beyond `chapter-source-auditor` to
> other phase-gated, artifact-producing skills.

Primary evidence inputs:

- `.codex/evidence/general-workflow-theory-branch-analysis.md`
- `.codex/evidence/general-workflow-theory-skill-corpus-analysis.md`
- Existing first-run evidence may be used as background, especially:
  - `.codex/evidence/agon-synthesis-evidence.md`
  - `.codex/evidence/chapter-source-auditor-skill-analysis.md`

## Sequential Prep Record

1. The brainstorm should test the broad theory, not re-answer whether
   `chapter-source-auditor` alone fits.
2. Kimi and Codex should challenge whether the applicability criteria are too broad, too
   narrow, or missing axes such as concurrency, permissions, and state machines.
3. The prior `chapter-source-auditor` conclusion is input, not proof.
4. The key stress cases are `orthogram-inquisitor` script authority and
   `knowledge-pipeline` state inference plus sanctioned `_raw` writes.
5. The desired output is a viability decision for one `WorkflowContract` schema with
   archetype extensions.
6. Ask for archetypes and anti-archetypes so the theory has boundaries.
7. Challenge the term `pipeline`; `workflow contract registry` may be safer.
8. The smallest implementation slice should likely be read-only extraction/conformance
   reporting, not live plugin execution.
9. Force concrete failure modes: vague metadata, unsafe auto-advance, under-modeled
   permissions, inconsistent state inference, checker/semantic `PASS` conflation, and alias
   hijacking.
10. Require a verdict and confidence, considering Kimi as an equal player but accepting no
    engine blindly.

## Prompt

We are evaluating a general workflow theory for Agon/Codex skills.

Evidence:

- `/Users/mrryf/develop/agon_testing/.codex/evidence/general-workflow-theory-branch-analysis.md`
- `/Users/mrryf/develop/agon_testing/.codex/evidence/general-workflow-theory-skill-corpus-analysis.md`
- Background if useful:
  - `/Users/mrryf/develop/agon_testing/.codex/evidence/agon-synthesis-evidence.md`
  - `/Users/mrryf/develop/agon_testing/.codex/evidence/chapter-source-auditor-skill-analysis.md`

Question:

Does the contract-first workflow/pipeline idea generalize beyond `chapter-source-auditor` to
other phase-gated, artifact-producing skills?

Please challenge the theory, not just summarize it. Assess whether one
`WorkflowContract`/`WorkflowSpec` schema with archetype-specific extensions can cover these
local skill archetypes:

- `chapter-source-auditor`
- `coherence-orchestrator`
- `fact-check`
- `orthogram-inquisitor`
- `knowledge-pipeline`

Answer:

1. Is the general theory sound, sound only with constraints, too broad, or wrong?
2. What are the non-negotiable core fields for a registry-invokable workflow contract?
3. Which fields must become archetype-specific extensions?
4. Does `knowledge-pipeline` require a separate abstraction because of state inference and
   `_raw` writes, or can it fit under typed invocation/mutation policies?
5. Does `orthogram-inquisitor` require a separate abstraction because scripts own gate/status
   authority, or can it fit under typed checker-authority policy?
6. What workflow archetypes and anti-archetypes should be named?
7. Should the term `pipeline` be avoided in favor of `workflow contract registry`?
8. What is the smallest safe implementation slice?
9. What conformance/parity tests would prove the theory without over-automating execution?

Treat Kimi and Codex as equal reviewers. Surface disagreements and confidence. Do not
blindly accept either engine.
