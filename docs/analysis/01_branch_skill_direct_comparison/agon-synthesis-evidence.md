# Agon Synthesis Evidence: chapter-source-auditor Workflow Registry Recommendation

## Run Metadata

- Mode: `agon synthesis`
- Successful run path: `/Users/mrryf/.agon/runs/synthesis-1782414493935-n2xx2i-chapter-source-auditor-workflow-`
- Command shape: `agon synthesis <prompt> -e kimi-code,codex --swaps=1 --timeout=900 --label chapter-source-auditor-workflow-contract-synthesis --quiet`
- Engines: `kimi-code`, `codex`
- Status: `2/2 succeeded`
- First attempt: failed under sandbox with `EPERM` while creating `/Users/mrryf/.agon/runs/...`
- Successful attempt: rerun with escalation for Agon's standard run-artifact directory
- Timeout extension: not needed; the successful run completed before the 900-second timeout
- Agon `status.json` summary: `2/2 drafted; winner=kimi-code`
- Important nuance: the selected `kimi-code-output.txt` artifact is an evaluator response that
  judges the Codex entry as stronger and declares `WINNER: "codex"`.

## Source Inputs

The synthesis prompt used these local evidence files as primary sources:

- `.codex/evidence/transformers-pipeline-architecture-branch-analysis.md`
- `.codex/evidence/chapter-source-auditor-skill-analysis.md`
- `.codex/evidence/agon-brainstorm-evidence.md`
- `.codex/evidence/agon-synthesis-prep.md`

## Synthesis Result

The synthesis supports making `chapter-source-auditor` available through an Agon workflow
registry, but not as a single executable pipeline.

Recommended shape:

- Non-executing family/discovery entry: `chapter-source-audit`
- Executable phase contracts:
  - `chapter-source-audit.block1.catalog`
  - `chapter-source-audit.block2.adjudicate`
  - `chapter-source-audit.block3.verify-integration`

The user-facing skill name can remain `$chapter-source-auditor`, while registry canonical
IDs use the shorter `chapter-source-audit...` family.

## WorkflowContract Decision

`WorkflowContract` is a good abstraction only if it is narrowly defined as declarative
contract metadata, not a generic runner factory.

It should centralize:

- canonical ID and aliases
- accepted surfaces
- invocation rules
- phase selector policy
- input schema
- read roots, write roots, and protected roots
- mutation/apply behavior
- evidence policy
- deterministic preflight/checker hooks
- required references/templates/artifacts
- parent artifact and freshness requirements
- semantic authority boundaries
- stop conditions
- next explicit invocation

It should not imply that every workflow is a linear pipeline or that phase gates can be
auto-progressed.

## Phase Shape

The synthesis rejects one monolithic `chapter-source-audit.pipeline` as unsafe. The phase
boundaries are part of the skill's safety design:

- Block 1 performs source-grounded cataloging and extraction, but produces no formal findings.
- Block 2 performs lineage/freshness-gated adjudication and findings generation.
- Block 3 verifies manual integration and never edits the thesis.

The family wrapper should be non-executing. It may list valid next invocations, but it must
not treat a broad prompt or `input=<path>` as permission to silently start Block 1.

## Deterministic Scripts And Semantic Authority

The synthesis separates deterministic checker authority from phase-level semantic judgment.

Scripts to expose as deterministic hooks:

- `invocation_contract_check.py`
- `scope_inventory.py`
- `manifest_tools.py`
- `artifact_contract_check.py`
- `run_index.py`

These scripts may report structural statuses such as valid/invalid invocation, present/missing
artifacts, fingerprint matches, freshness, and integrity mismatches. They must not report
source-truth verdicts such as claim validity, finding confirmation, or semantic integration
success.

Important nuance from the synthesis: Block 3 may legitimately use semantic verdict labels
such as `PASS`, `MINOR DIVERGENCE`, `MAJOR DIVERGENCE`, and `BLOCKED`, but that authority
belongs to phase execution, not deterministic checker scripts.

## Agon Pipeline Ambiguity

The synthesis repeats the branch finding that Agon's existing `pipeline` routes are overloaded:

- Slash `/pipeline`: build -> fitness -> parallel review -> fix loop
- MCP in-session `pipeline`: same build-review-fix handler
- `agon call pipeline`: brainstorm -> forge -> tribunal
- MCP direct `Pipeline`: delegates to `agon call pipeline`
- Plan-mode `pipeline`: brainstorm -> forge -> tribunal, but without the same apply behavior

This ambiguity should be fixed or isolated before workflow/plugin machinery depends on
the word `pipeline`.

Minimum isolation for the auditor workflow:

- Do not allow `pipeline`, `audit`, `source-check`, or other broad aliases to resolve to
  `chapter-source-audit`.
- Require canonical IDs or explicit `$chapter-source-auditor block|phase=...` selectors.
- Add tests proving legacy `pipeline` routes cannot reach the auditor family.

## Smallest Safe Implementation Slice

The synthesis recommends implementing only Block 1 first:

1. Add a KERN-sourced workflow contract registry table.
2. Add non-executing family entry `chapter-source-audit`.
3. Add executable contract `chapter-source-audit.block1.catalog`.
4. Normalize only `block=1`, `phase=1`, and canonical ID lookup.
5. Reject implicit invocation, missing selector, duplicate selector, unknown selector, and
   Block 1 without `input`.
6. Register `invocation_contract_check.py` and `scope_inventory.py` as structural hooks.
7. Declare read roots, protected roots, write root, evidence policy, mutation policy, stop
   conditions, and next invocation.
8. Expose/list the contract through the registry.
9. Do not implement Blocks 2/3 execution, auto-progression, generic plugin workflow loading,
   a new runner framework, or semantic script judgments in this slice.

## Required Tests

Registry and alias tests:

- canonical Block 1 lookup returns `chapter-source-audit.block1.catalog`
- `block=1`, `phase=1`, and canonical ID resolve to the same contract
- unknown IDs and ambiguous aliases reject
- family ID returns discovery metadata only

Invocation tests:

- explicit Block 1 with `input` accepts
- missing selector rejects
- duplicate selector rejects
- unknown selector rejects
- Block 1 without `input` rejects
- natural language prompts do not trigger the workflow

Mutation tests:

- thesis Markdown files remain unchanged
- `_raw` files remain unchanged
- protected roots remain unchanged
- previous-run roots remain unchanged
- generated artifacts appear only under the declared run root

Checker-authority tests:

- deterministic scripts emit structural/checker statuses only
- scripts do not emit source-accuracy or integration verdicts
- Block 3 semantic verdict labels are preserved as phase-execution decisions, not checker output

No-auto-advance and pipeline-isolation tests:

- successful Block 1 stops
- no surface invokes Block 2 automatically
- continuation state reports the next allowed explicit invocation
- no legacy `pipeline` route resolves to `chapter-source-audit`

## Additional Synthesis Caveat

Kimi's selected evaluator artifact flagged one missing concern in the Codex synthesis:
concurrent or colliding invocations. A production contract should eventually define run
directory locking, scope/run ID uniqueness, stale parent-artifact detection, and Block 2/3
lineage behavior when multiple runs share a scope. This does not block the Block 1 metadata
slice, but it should be captured before any multi-run or multi-phase execution support.

## Bottom Line

The skill is a good candidate for an Agon workflow registry because it already has contract
discipline. The first safe vessel is not a monolithic pipeline; it is a metadata-first
workflow family with one executable Block 1 phase contract, a non-executing wrapper, explicit
selectors, structural-only deterministic hooks, generated-artifact-only writes, and parity
tests across supported invocation surfaces.
