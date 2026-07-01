# General Workflow Theory: Agon Brainstorm Evidence

## Run Metadata

- Mode: `agon brainstorm`
- Run path: `/Users/mrryf/.agon/runs/brainstorm-1782417003413-tazdax-general-workflow-theory-brainsto`
- Command shape: `agon brainstorm <prompt> -e kimi-code,codex --timeout=900 --label general-workflow-theory-brainstorm --quiet`
- Engines: `kimi-code`, `codex`
- Status: `2/2 succeeded`
- Agon summary: `2/2 bid; winner=codex`
- Confidence bids:
  - `kimi-code`: `confidence=33`
  - `codex`: `confidence=91`

## Source Inputs

- `.codex/evidence/general-workflow-theory-branch-analysis.md`
- `.codex/evidence/general-workflow-theory-skill-corpus-analysis.md`
- `.codex/evidence/general-workflow-theory-brainstorm-prep.md`
- Background: `.codex/evidence/agon-synthesis-evidence.md`

## Prompt Focus

The brainstorm tested whether the contract-first workflow/pipeline idea generalizes beyond
`chapter-source-auditor` to other phase-gated, artifact-producing skills. It asked Kimi and
Codex to challenge whether one `WorkflowContract` schema with archetype-specific extensions
can cover:

- `chapter-source-auditor`
- `coherence-orchestrator`
- `fact-check`
- `orthogram-inquisitor`
- `knowledge-pipeline`

It specifically stressed:

- `knowledge-pipeline` state inference and sanctioned `_raw` writes
- `orthogram-inquisitor` script-authoritative gates/status
- core fields vs archetype fields
- archetypes and anti-archetypes
- avoiding the term `pipeline`
- smallest safe implementation slice
- conformance tests

## Kimi Position

Kimi's answer was conservative and implementation-oriented.

Core position:

- Adopt a core `WorkflowContract` schema with typed archetype-specific extensions.
- Drop the overloaded `pipeline` term.
- Implement a read-only conformance inventory before runtime extraction.

Kimi emphasized:

- The five-skill corpus forces separation between core schema and archetype extensions.
- State-inferred phase progression, sanctioned `_raw` writes, and script-owned gate status
  are archetype-specific, not universal.
- The safest path is "read first": validate contract coverage before committing to any
  runner abstraction.
- Authority-boundary vocabulary may be too coarse for conversion-runtime skills.

Kimi proposed a concrete read-only implementation sequence:

1. Define core `WorkflowContract` schema with a discriminated archetype extension slot.
2. Model five validated archetypes plus named anti-archetypes.
3. Declare distinct invocation, mutation, and authority policies for `knowledge-pipeline`
   and `orthogram-inquisitor`.
4. Build a read-only registry loader and conformance checker.
5. Add parity tests for canonical ID, alias normalization, phase selector resolution, and
   legacy `pipeline` isolation.
6. Add mutation/authority tests for `_raw` writes and script gate statuses.
7. Ship a conformance report and gate runtime extraction on zero coverage failures.

## Codex Position

Codex's selected brainstorm output judged the theory "sound only with constraints."

Core position:

> A skill is registry-invokable when its invocation, phase model, inputs, outputs,
> artifact lineage, mutation policy, authority boundaries, and supported surfaces can be
> declared and tested as a contract.

Codex agreed that the theory generalizes across the five local skills, but only if it is
not a universal pipeline runtime.

Codex's proposed core fields:

- `id`
- `version`
- `source_skill`
- `archetype`
- `invocation_policy`
- `aliases`
- `supported_surfaces`
- `phase_model`
- `input_schema`
- `artifact_policy`
- `read_policy`
- `write_policy`
- `mutation_behavior`
- `deterministic_hooks`
- `authority_boundary`
- `stop_conditions`
- `next_invocation`
- `conformance_tests`

Codex's recommended archetypes:

- `phase_gated_semantic_audit`
- `structural_coherence_workflow`
- `citation_verification_workflow`
- `checker_authoritative_validation`
- `ingest_conversion_workflow`

Codex's anti-archetypes:

- open-ended chat skills
- pure reference/library skills with no workflow boundary
- ambient auto-router behavior
- unconstrained agent loops
- skills whose mutation behavior cannot be declared
- workflows with intentionally fuzzy aliases
- tools that install dependencies or mutate environment state outside declared policy
- one-off scripts with no stable artifact contract

## Agreements

Both engines agreed that:

- The general theory is viable only as a contract/archetype theory.
- The term `pipeline` should be avoided for new registry surfaces because Agon already
  overloads it.
- `knowledge-pipeline` and `orthogram-inquisitor` fit, but only if the schema supports
  typed invocation, mutation, and checker-authority policies.
- The smallest safe implementation slice is read-only contract inventory/conformance
  reporting, not plugin execution or a universal runner.
- Runtime extraction should wait until conformance coverage is proven.

## Tensions

The main tension is implementation pace:

- Kimi emphasized read-only conformance before any runner commitment.
- Codex accepted the same constraint but provided a fuller schema and test plan.

No engine argued for a universal pipeline runtime. Both rejected that interpretation.

## Brainstorm Conclusion

The brainstorm strengthens the general theory, but only under a precise formulation:

> Use a workflow contract registry with a strict core schema and typed archetype extensions.
> Do not build a universal pipeline runner. Do not use `pipeline` as the public registry
> term. Start with read-only conformance inventory and tests.

The theory is not "all skills are pipelines." It is "some skills are registry-invokable
workflows when their behavior can be declared and tested as contracts."
