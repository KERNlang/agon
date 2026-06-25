# General Workflow Theory: Agon Synthesis Evidence

## Run Metadata

- Mode: `agon synthesis`
- Run path: `/Users/mrryf/.agon/runs/synthesis-1782418134992-1wbjzc-general-workflow-theory-synthesi`
- Command shape: `agon synthesis <prompt> -e kimi-code,codex --swaps=1 --timeout=900 --label general-workflow-theory-synthesis --quiet`
- Engines: `kimi-code`, `codex`
- Status: `2/2 succeeded`
- Agon summary: `2/2 drafted; winner=kimi-code`
- Run start: `2026-06-25T20:08:54.991Z`
- Run end: `2026-06-25T20:15:10.496Z`

The run was started with escalation because `agon synthesis` writes its standard run
artifacts under `/Users/mrryf/.agon/runs`.

## Source Inputs

- `.codex/evidence/general-workflow-theory-branch-analysis.md`
- `.codex/evidence/general-workflow-theory-skill-corpus-analysis.md`
- `.codex/evidence/general-workflow-theory-brainstorm-evidence.md`
- `.codex/evidence/general-workflow-theory-synthesis-prep.md`

## Final Valid Claim

The synthesis supports this constrained general claim:

> A skill can become a registry-invokable workflow when its invocation behavior, phase or
> step model, inputs, outputs, artifact lineage, mutation policy, authority boundaries,
> deterministic helpers, stop conditions, and supported surfaces can be declared and tested
> as a versioned contract.

This generalizes beyond `chapter-source-auditor` to the inspected local skills:

- `coherence-orchestrator`
- `fact-check`
- `orthogram-inquisitor`
- `knowledge-pipeline`

The claim is valid as a **contract and archetype theory**, not as a universal runtime or
universal phase lifecycle theory.

## Rejected Overclaims

The synthesis rejects these stronger claims:

- all skills are pipelines
- all workflows should share one phase lifecycle
- all workflow outputs are `.codex` artifacts only
- all deterministic scripts are merely structural helpers
- shared runner extraction should come before contract inventory
- broad `pipeline` terminology is safe for the public registry abstraction

## Abstraction Decision

Use `WorkflowSpec` for the declarative artifact and `WorkflowContract` for the behavioral
promise/conformance target.

Preferred public terms:

- `WorkflowSpec`
- `WorkflowRegistry`
- `WorkflowConformanceReport`
- `WorkflowArchetype`

Avoid `PipelineRegistry` and avoid `pipeline` as the umbrella term because Agon's existing
`pipeline` behavior already diverges across surfaces.

## Core Schema

The strict core should contain fields that every registry-invokable workflow must declare
and that the host can validate:

- identity: `id`, `version`, `source_skill`, title/description
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
- authority boundary across script, agent, human, and semantic decisions
- stop conditions
- preflight requirements
- conformance tests

The synthesis cautions that the core must stay strict. Domain judgment, report schemas,
runtime details, OCR rules, stale-hash rules, packet authority, and checker normalization
belong in typed extensions unless they directly affect invocation, artifacts, writes,
authority, or surface parity.

## Typed Archetype Extensions

The synthesis names these initial archetypes:

- `phase_gated_semantic_audit`
  - examples: `chapter-source-auditor`, parts of `fact-check`
  - needs local evidence boundaries, source-read requirements, source-semantic judgment,
    report sections, and no-auto-advance rules
- `structural_coherence_workflow`
  - example: `coherence-orchestrator`
  - needs document sets, packet authority, source-semantic handoffs, freshness checks, and
    structural/source-semantic status lanes
- `citation_verification_workflow`
  - example: `fact-check`
  - needs report phases, citation map schema, stale-hash policy, search restrictions, and
    overwrite confirmation rules
- `checker_authoritative_validation`
  - example: `orthogram-inquisitor`
  - needs checker tools, normalized statuses, script-owned gates, validation lineage, and
    residual-risk language
- `ingest_conversion_workflow`
  - example: `knowledge-pipeline`
  - needs state roots, operational state files, conversion outputs, generated domain-output
    roots, phase inference rules, OCR gates, human acceptance gates, and batch manifest
    policy

## Stress Cases

### `knowledge-pipeline`

`knowledge-pipeline` fits the theory, but forces the schema to support:

- `state_inference_allowed: true`
- phase model: `check`, `convert`, `validate`, `accept`, `status`
- operational state under `_pipeline`
- sanctioned generated Markdown writes to `_raw`
- generated-domain-output mutation separate from source mutation
- human acceptance gates
- conversion runtime authority
- no dependency/environment mutation unless declared

The key distinction is:

```yaml
mutates_source_files: false
mutates_generated_domain_outputs: true
generated_artifacts_only: false
```

### `orthogram-inquisitor`

`orthogram-inquisitor` fits the theory, but forces the schema to support checker-authority
contracts:

- explicit `audit` and `validate` phases
- alias normalization followed by stop/no auto-advance
- checker output normalization
- validation lineage under a prior audit run
- deterministic script and LanguageTool authority over gates/status
- model prose that cannot override checker status

## Anti-Archetypes

The synthesis excludes these from workflow registry admission until redesigned with stable
contracts:

- `open_ended_chat_skill`
- `reference_only_skill`
- `ambient_auto_router`
- `unconstrained_agent_loop`
- `undeclared_mutation_tool`
- `fuzzy_alias_workflow`
- `environment_mutating_installer`
- `one_off_script_without_artifact_contract`

Reasons for exclusion:

- no stable invocation boundary
- no testable output contract
- no declared mutation behavior
- no phase/step or terminal condition
- ambiguous aliases by design
- side effects exceed declared policy
- behavior cannot be checked across surfaces

## Smallest Safe Implementation Slice

The synthesis recommends a read-only first slice:

1. Define `WorkflowSpec` core schema.
2. Define typed extension discriminators by `archetype`.
3. Version the schema from the start.
4. Add specs for the five inspected workflows.
5. Include current first-party workflow surfaces where drift already exists.
6. Mark unsupported surfaces explicitly.
7. Build a read-only registry loader.
8. Build a conformance checker.
9. Emit machine-readable and human-readable conformance reports.
10. Keep legacy `pipeline` behavior explicitly isolated.

Do not begin with:

- live invocation
- plugin execution
- shared runner extraction
- auto-progression
- mutation beyond declared report generation

## Conformance Tests

Minimum test groups:

- identity and alias tests
- surface parity tests
- phase model tests
- artifact and lineage tests
- read/write/mutation tests
- authority-boundary tests
- `knowledge-pipeline` stress-case tests
- `orthogram-inquisitor` stress-case tests
- documentation parity tests

Key assertions:

- canonical IDs resolve consistently
- ambiguous aliases fail closed
- unsupported surfaces fail explicitly
- state inference only occurs when declared
- generated-domain-output writes are allowed only when declared
- protected roots are never writable
- script-owned gate status cannot be overridden by model prose
- checker `PASS` and semantic `PASS` remain distinct
- docs and registry cannot drift silently

## Additional Caveat From Selected Synthesis

The selected `kimi-code` synthesis flagged a missing enforcement concern in both drafts:
path canonicalization and root matching.

A production conformance checker must define platform-level root enforcement rules:

- resolve symlinks before read/write policy checks
- handle case-insensitive filesystems correctly
- compare canonical paths, not raw string prefixes
- reject path traversal and ambiguous roots
- distinguish generated domain-output roots from protected source roots after canonicalization

Without this, declared mutation policies could be bypassed by malformed paths, symlinks, or
case differences.

## Remaining Caveats

- The corpus is local and strong enough for directional validation, not universal proof.
- Schema versioning and migration policy are required.
- Concurrency, run locking, stale state, and artifact races need a later design.
- Plugin trust boundaries, permissions, signing, and review are separate from workflow
  contract shape.
- Authority vocabulary may need refinement after real conformance reports.
- Existing `pipeline` terminology needs deliberate compatibility handling.

## Bottom Line

Adopt the general theory in this constrained form:

> Build a versioned `WorkflowSpec` registry for artifact-producing skills whose behavior can
> be declared and tested. Use a strict shared core plus typed archetype extensions. Avoid
> `pipeline` as the public abstraction. Start with read-only inventory and conformance
> checks. Defer shared runtime execution until the contracts prove stable across real
> workflows.

This captures the real commonality across the inspected skills without flattening the
differences between semantic audits, structural workflows, checker-authoritative validation,
citation verification, and ingest/conversion workflows.
