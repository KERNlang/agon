# General Workflow Theory: Skill Corpus Analysis

## Scope

This artifact records a 15-step sequential-thinking analysis of whether the
contract-first workflow/pipeline theory generalizes beyond `chapter-source-auditor`.

Local skill corpus inspected:

- `/Users/mrryf/develop/notes/thesis/.agents/skills/chapter-source-auditor`
- `/Users/mrryf/develop/notes/thesis/.agents/skills/coherence-orchestrator`
- `/Users/mrryf/develop/notes/thesis/.agents/skills/fact-check`
- `/Users/mrryf/develop/notes/thesis/.agents/skills/orthogram-inquisitor`
- `/Users/mrryf/develop/notes/thesis/.agents/skills/knowledge-pipeline`

Primary files inspected:

- each skill's `SKILL.md`
- script/reference/eval inventories for all five skills
- selected references:
  - `knowledge-pipeline/references/phase-contract.md`
  - `coherence-orchestrator/references/workflow.md`
  - `orthogram-inquisitor/references/workflow.md`
  - `fact-check/evals/trigger-queries.json`

## Sequential-Thinking Record

1. The local corpus has five relevant skills, enough to test multiple workflow archetypes.
2. `chapter-source-auditor` is the strongest explicit phase-gated semantic audit exemplar.
3. `coherence-orchestrator` independently validates the phase-gated artifact workflow shape.
4. `fact-check` validates a simpler explicit three-phase local evidence workflow.
5. `orthogram-inquisitor` validates the same contract fields with stronger deterministic
   script authority.
6. `knowledge-pipeline` is the stress test because it is phase-gated but state-inferred and
   intentionally writes converted Markdown to `_raw`.
7. The shared minimum is a declared invocation boundary, not universal explicit phase
   selectors.
8. Canonical phase IDs generalize, but phase labels may be numeric, named, or command-like.
9. Artifact roots and lineage behavior generalize, but artifact classes differ.
10. Mutation policies generalize, but generated-artifact-only is an archetype, not universal.
11. Deterministic hooks generalize strongly, with varying authority levels.
12. Semantic authority boundaries are required but type-specific.
13. A taxonomy emerges: phase-gated semantic audit, structural coherence workflow,
    checker-authoritative audit/validation, citation verification, and ingest/conversion.
14. The schema needs required core fields plus archetype-specific extensions.
15. Corpus conclusion: the general theory is plausible if framed as contract/archetype theory,
    not a single pipeline runtime.

## Applicability Criteria

A skill fits the contract-first workflow registry model when it can declare:

- canonical workflow ID
- invocation boundary
- aliases or phase selector normalization
- phase/step model
- required inputs per phase
- output artifacts per phase
- artifact roots and lineage policy
- read roots and protected roots
- write roots and mutation behavior
- deterministic scripts/tools and their authority
- semantic or human authority boundaries
- stop conditions
- next-invocation or progression rules
- supported surfaces or explicit non-support
- conformance/parity tests

The criterion is **not** that every skill is explicit-only, `.codex`-only, or
non-mutating. Those are contract values, not universal requirements.

## Skill Matrix

| Skill | Archetype | Invocation Boundary | Phase Model | Artifact/Output Model | Mutation Model | Authority Model | Fit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `chapter-source-auditor` | phase-gated semantic audit | explicit-only `$chapter-source-auditor` with exactly one block/phase selector | `block=1|2|3` / `phase=1|2|3` | `.codex/research/chapter_source_audit/<scope>/runs/<run-id>/` | thesis/raw/protected roots read-only; generated audit artifacts only | scripts structural only; agent/human source-semantic judgment | strong |
| `coherence-orchestrator` | structural coherence workflow with source-semantic routing | explicit `phase=catalog|clarify|verify` | three named phases, no auto-advance | `.codex/coherence/<scope>/runs/<run-id>/phase-*` | input folders/protected thesis roots read-only; artifacts only under scope root | scripts structural only; coherence semantics separate from source truth | strong |
| `fact-check` | local citation verification workflow | explicit `$fact-check`, with limited report auto-detection after explicit invocation | `map`, `verify`, `assess` | `fact-check-reports/<section>/phase1-map.md`, `phase2-verify.md`, `phase3-assess.md` | thesis/raw read-only; exact overwrite phrase required for existing reports | model performs local source-grounded verification/assessment; scripts normalize/report-check | strong |
| `orthogram-inquisitor` | checker-authoritative audit/validation | explicit `$orthogram-inquisitor phase=audit|validate` | `audit`, `validate`; aliases normalize then stop | `.codex/research/orthogram_inquisitor/<scope>/runs/<run-id>/` plus validation under audit lineage | thesis Markdown read-only; artifacts only under run roots | deterministic scripts and LanguageTool own gates/status; model prose cannot override | strong |
| `knowledge-pipeline` | ingest/conversion pipeline | `$knowledge-pipeline` shorthand plus state-based phase inference | `check`, `convert`, `validate`, `accept`, `status` | `_pipeline/*` operational state, manifests, reports, and `_raw/*.md` converted sources | intentionally writes generated Markdown to `_raw` and state to `_pipeline`; no dependency install | scripts/runtime own conversion and validation; human acceptance gates source status | strong but requires schema variants |

## Archetypes

### Phase-Gated Semantic Audit

Examples:

- `chapter-source-auditor`
- parts of `fact-check`

Contract needs:

- explicit invocation
- phase/block selectors
- local evidence boundary
- full-read requirements
- source-semantic authority rules
- generated artifact roots
- no auto-advance

### Structural Coherence Workflow

Example:

- `coherence-orchestrator`

Contract needs:

- cross-document input sets
- source-semantic routing/handoff fields
- packet authority classes
- phase lineage and freshness checks
- structural vs source-semantic status lanes

### Checker-Authoritative Audit/Validation

Example:

- `orthogram-inquisitor`

Contract needs:

- local tool/runtime requirements
- script-owned gates and status
- checker output normalization
- residual-risk language
- validation lineage under prior audit run

### Citation Verification Workflow

Example:

- `fact-check`

Contract needs:

- phase reports
- path/report auto-detection after explicit invocation
- source read plan
- stale hash policy
- exact overwrite permissions
- phase-specific search restrictions

### Ingest/Conversion Pipeline

Example:

- `knowledge-pipeline`

Contract needs:

- state-based phase inference
- conversion runtime requirements
- operational state under `_pipeline`
- generated domain outputs under `_raw`
- manual OCR/acceptance gates
- batch manifest preservation
- reconciliation/status reporting

## Schema Implications

The general contract schema should have a stable core plus typed extensions.

Core fields:

```yaml
id: string
version: string
kind: family | phase | command | report
source_skill: string
description: string
archetype: string
invocation_policy:
  explicit_required: boolean
  phase_selector_required: boolean
  auto_detection_allowed: boolean
  state_inference_allowed: boolean
aliases: []
phase_model:
  phases: []
  auto_advance: never | explicit_only | state_inferred | allowed
input_schema: {}
artifact_policy:
  output_roots: []
  lineage_required: boolean
  overwrite_policy: string
read_policy:
  read_roots: []
  full_read_required: boolean
write_policy:
  write_roots: []
  protected_roots: []
mutation_behavior:
  mutates_source_files: boolean
  mutates_generated_domain_outputs: boolean
  generated_artifacts_only: boolean
deterministic_hooks: []
authority_boundary:
  script_authority: structural | gate_status | runtime_conversion
  semantic_authority: agent | human | script_limited | none
stop_conditions: []
next_invocation: {}
supported_surfaces: []
conformance_tests: []
```

Archetype-specific extensions should cover:

- source-semantic audit rules
- structural coherence packet authority
- checker/language-tool status authority
- citation/source-read plans
- conversion runtime and OCR/acceptance gates

## Theory Corrections From The Corpus

The corpus strengthens the general theory but forces several corrections:

1. **Explicit-only is common but not universal.** `knowledge-pipeline` uses state-based phase
   inference, and `fact-check` has explicit no-argument report auto-detection.
2. **Generated-artifact-only is common but not universal.** `knowledge-pipeline` legitimately
   writes generated Markdown to `_raw`.
3. **Scripts are not always structural-only.** `orthogram-inquisitor` makes scripts
   deterministic authority for gates and artifact status; `knowledge-pipeline` scripts are
   the conversion runtime.
4. **Semantic authority is not one field.** Source-semantic, structural-semantic,
   checker-status, language-surface, conversion-quality, and human acceptance decisions
   must be separated.
5. **Phase progression can be explicit, inferred, or terminal-reporting.** A general schema
   must represent all three.

## Bottom Line

The general workflow theory is directionally validated across the local skill corpus. It
should be framed as a **contract and archetype theory**, not as a universal pipeline runtime.

The pipeline goes in the right direction if it means:

- canonical IDs
- typed invocation policies
- phase/step contracts
- declared artifacts and lineage
- explicit mutation and write policies
- deterministic hook authority
- semantic/human authority boundaries
- conformance tests across surfaces

It goes in the wrong direction if it assumes:

- every workflow is explicit-only
- every workflow is `.codex` artifact-only
- every script is structural-only
- every phase must be manually selected
- every skill can share one runner lifecycle
