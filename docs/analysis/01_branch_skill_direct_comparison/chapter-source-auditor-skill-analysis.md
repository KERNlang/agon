# Chapter Source Auditor Skill Analysis

Date: 2026-06-25

Skill path inspected:

`/Users/mrryf/develop/notes/thesis/.agents/skills/chapter-source-auditor`

## Scope

This artifact records a 15-step sequential-thinking analysis of the `chapter-source-auditor` skill as a possible Agon workflow/pipeline registry candidate.

The analysis inspected:

- `SKILL.md`
- `agents/openai.yaml`
- `references/workflow.md`
- `references/boundaries.md`
- `references/scope-resolution.md`
- `references/artifact-schemas.md`
- `references/semantic-reliability-contract.md`
- `references/empirical-evidence-rules.md`
- `references/false-positive-control.md`
- `references/integration-verification-rubric.md`
- `references/previous-run-comparison.md`
- `references/redundancy-and-scope-drift.md`
- `references/requirements-provenance.md`
- `references/eval-plan.md`
- scripts under `scripts/`
- eval manifests under `evals/`
- template inventory under `assets/templates/`

## Sequential-Thinking Record

1. Defined the skill as a governed audit protocol, not a simple prompt skill.
2. Identified the invocation contract: explicit `$chapter-source-auditor` plus exactly one `block`/`phase` selector.
3. Identified hard phase boundaries: one block per invocation, write artifacts, state next invocation, stop.
4. Analyzed Block 1 as scope resolution, inventory, full reading, atomic extraction, and no findings.
5. Analyzed Block 2 as lineage/integrity/freshness gates, phase-local rereading, candidate adjudication, findings, and packets.
6. Analyzed Block 3 as integration verification of user-applied amendments, not editing.
7. Identified mutation policy: generated artifacts only; thesis, raw sources, protected roots, and previous-run roots are read-only.
8. Identified evidence boundary: local thesis and local raw sources only; no web/model-memory/search-only source evidence.
9. Mapped artifact schemas: run metadata, controlled fields, manifests, candidates, findings, packets, before/after units, decision logs, empirical evidence, and integration checks.
10. Classified helper scripts as deterministic non-semantic preflight/checker capabilities.
11. Mapped stop conditions: ambiguous run, mutated artifacts, stale inputs, source ambiguity, raw-source drift, packet-only narrowing, authorial decisions.
12. Identified durable state spine: run root, run ID, scope ID, artifact index, integrity manifest, continuation state, block status, parent artifact IDs.
13. Judged registry fit: best as three block-level workflow contracts plus an optional wrapper, not an auto-progressing monolithic pipeline.
14. Listed required contract fields beyond ordinary Agon modes: evidence policy, read-only roots, checker boundaries, artifact inventory, semantic authority, next-invocation rules.
15. Final conclusion: the workflow contract table is a plausible vessel, but the smallest safe slice is metadata + preflight + artifact/checker integration for one block at a time.

## Architectural Shape

The skill is a three-block, explicit-only, phase-gated workflow.

Accepted invocation forms:

- `$chapter-source-auditor block=1 input=<chapter-or-subchapter-path>`
- `$chapter-source-auditor block=2 run_id=<run-id>`
- `$chapter-source-auditor block=3 run_id=<run-id> integration_target=<path>`

Aliases:

- `phase=1`
- `phase=2`
- `phase=3`

The skill rejects implicit use. `agents/openai.yaml` sets `allow_implicit_invocation: false`, and `SKILL.md` says ordinary review, proofreading, thesis editing, source checking, or audit prompts must not trigger it.

## Block Contracts

### Block 1: Catalog And Source-Reading Basis

Purpose:

- Resolve input scope.
- Inventory thesis Markdown and local raw sources.
- Fully read scoped thesis Markdown.
- Identify and fully read concerned raw sources.
- Create passage inventory, atomic claim matrix, source-support units, empirical evidence ledger, read ledger, source notes, drift check, verification rubric, integration-check template, progress log, artifact index, and integrity manifest.

Important constraints:

- No formal findings.
- No amendment proposals.
- No thesis or raw-source edits.
- Structural completion does not imply semantic completion when passage rows remain blocked/unclear.

### Block 2: Source-Grounded Findings And Packets

Purpose:

- Resolve exactly one run.
- Verify parent lineage and artifact integrity.
- Check freshness and drift.
- Read mandatory Block 1 artifacts.
- Reread all concerned raw sources in full for Block 2.
- Convert watchpoints, at-risk atomic claims, at-risk source-support units, previous-run carry-forward items, and regression carry-forward items into governed dispositions.
- Produce findings, findings index, candidate disposition, empirical validation, false-positive/rejected-candidate records, validated-without-amendment records, redundancy verification, decision log, non-source hygiene notes, packets, artifact index, and manifest updates.

Important constraints:

- Every candidate gets exactly one governed disposition.
- Formal findings require source-grounded necessity.
- False-positive challenge is mandatory for findings.
- False-negative challenge is mandatory for `validated_without_amendment` and `validated_with_limits_no_amendment`.
- Authorial wording, placement, split, merge, or compression decisions pause the run before final packet construction.

### Block 3: Manual Integration Verification

Purpose:

- Verify the user's manual integration against Block 2 packets and before/after integration units.
- Read selected run artifacts, current target thesis files, and required raw sources.
- Compare current integrated text against packet instructions and do-not-change truth conditions.
- Record empirical preservation.
- Classify each item as `PASS`, `MINOR DIVERGENCE`, `MAJOR DIVERGENCE`, or `BLOCKED`.
- Write overview, integration checks, empirical integration check, source reread ledger, source rereading notes, verification report, artifact index, and integrity manifest update.

Important constraints:

- Never edit the thesis.
- Packet-only verification requires explicit user confirmation and must record `verification_scope=packet-only`.
- Deterministic checker status must not be confused with Block 3 semantic classification.

## Evidence And Mutation Policies

### Read-Only Inputs

- Thesis Markdown files.
- `_raw` source files.
- Declared `protected_roots`.
- Completed `.codex/research/trust_xai_audit/runs/` evidence.
- Previous-run roots.

### Write Targets

The normal artifact tree is:

```text
.codex/research/chapter_source_audit/<scope-id>/runs/<run-id>/
```

The skill writes generated artifacts, manifests, indexes, ledgers, packets, and verification reports only.

### Evidence Boundary

Allowed source evidence:

- Local thesis files.
- Local raw sources.

Forbidden as source evidence:

- web research;
- model-memory knowledge;
- abstracts/snippets/citation mining;
- semantic search/vector search/PDF search/search-only evidence;
- prior artifacts or hashes as substitutes for current reading.

Search is allowed only for inventory, non-source navigation, or locator recovery after full reading.

## Data Model

The skill has a mature schema surface:

- run metadata;
- governed semantic fields;
- scoped passage inventory;
- coverage crosswalk;
- atomic claim matrix;
- source-support unit table;
- input freshness fingerprints;
- artifact integrity manifest;
- source drift check;
- candidate disposition;
- regression cluster map;
- previous-run comparison;
- continuation state;
- checker status namespace;
- finding schema;
- before/after integration unit;
- packet schema;
- decision log;
- empirical evidence ledger;
- Block 3 integration check.

The controlled values in `semantic-reliability-contract.md` are a strong fit for a workflow contract table because they separate:

- structural status;
- behavioral semantic status;
- checker semantic status;
- source role;
- support status;
- boundary status;
- limitation status;
- disposition;
- read status;
- drift status.

## Script Helpers

The script layer provides deterministic, non-semantic helpers:

- `invocation_contract_check.py`
  - Validates explicit invocation syntax.
  - Checks selectors and previous-run forms.
  - Does not import prior memory or judge source truth.
- `scope_inventory.py`
  - Inventories thesis and raw files.
  - Computes fingerprints, line counts, raw categories, and unresolved concerned status.
  - Does not decide concerned sources or validate claims.
- `manifest_tools.py`
  - Fingerprints files.
  - Verifies artifact manifests and payload hashes.
  - Compares input fingerprint sets.
  - Does not validate source claims.
- `artifact_contract_check.py`
  - Checks required artifacts, metadata, tables, headings, controlled fields, lineage proxies, packets, and Block 3 structural checks.
  - Emits structural/checker semantic statuses only.
  - Explicitly does not assign source accuracy or integration verdicts.
- `run_index.py`
  - Builds deterministic run artifact indexes.
  - Refuses writes outside safe run-level pointer/index targets.
  - Does not infer semantic status.

These scripts map well to pipeline preflight and verification hooks, but not to semantic audit execution.

## Eval Surface

The eval manifests show the skill already thinks in contract terms:

- `trigger-queries.json`: explicit invocation and rejection cases.
- `negative-cases.json`: raw-root, stale-parent, mutated-parent, ambiguous-run, empirical, redundancy, authorial-decision, previous-run, and dense-collapse cases.
- `semantic-regression-cases.json`: small and full semantic regression targets, including `FULL-F01` through `FULL-F15`.
- `block3-integration-cases.json`: exact, partial, wrong, missing-packet, and empirical-boundary-loss verification cases.
- `fixture-assertions.json`: required headings, statuses, and no-edit constraints.

The eval plan explicitly separates structural checks from behavioral semantic review. That aligns with an Agon contract table where some checks can be deterministic and others require agent/human semantic judgment.

## Registry Fit

This skill is a strong candidate for workflow registry metadata because it already declares:

- canonical invocation surface;
- phase/block aliases;
- per-block required inputs;
- per-block required artifacts;
- read-only and write boundaries;
- evidence policy;
- preflight scripts;
- checker scripts;
- mutation policy;
- stop conditions;
- next allowable invocation.

The right abstraction is not a generic `Pipeline` class. It is a `WorkflowContract` or `WorkflowSpec` with phase-level contracts.

## Proposed Canonical Workflow IDs

Suggested first-party/plugin IDs:

- `chapter-source-audit.block1.catalog`
- `chapter-source-audit.block2.adjudicate`
- `chapter-source-audit.block3.verify-integration`

Optional wrapper:

- `chapter-source-audit`

The wrapper should be discovery/orchestration metadata only at first. It must not auto-progress from Block 1 to Block 2 to Block 3 unless the user explicitly opts into a supervised multi-phase mode and all gates pass.

## Minimal Contract Fields For This Skill

At minimum, each block needs:

- `id`
- `aliases`
- `description`
- `accepted_surfaces`
- `input_schema`
- `required_capabilities`
- `read_roots`
- `write_roots`
- `mutation_behavior`
- `evidence_policy`
- `preflight_checks`
- `required_references`
- `required_templates`
- `required_artifacts`
- `parent_artifact_requirements`
- `freshness_policy`
- `semantic_authority_boundary`
- `stop_conditions`
- `next_invocation`
- `deterministic_checkers`
- `human_or_agent_review_required`

## Smallest Safe Implementation Slice

1. Register only Block 1 as a declarative workflow contract.
2. Add a parser/preflight wrapper around `invocation_contract_check.py`.
3. Expose `scope_inventory.py` as a non-semantic inventory preflight.
4. Declare artifact write root and no-edit protected roots.
5. Generate a contract inventory entry that can be listed by registry ID.
6. Do not automate semantic source judgment through scripts.
7. Do not auto-progress to Block 2.
8. Add parity tests that verify:
   - valid explicit Block 1 invocation is accepted;
   - implicit prompts are rejected;
   - duplicate/missing selectors are rejected;
   - write policy excludes thesis/raw files;
   - deterministic checks emit structural status, not semantic PASS.

## Bottom Line

Yes, the branch's workflow contract idea is a plausible vessel for this skill.

The skill is already more contract-shaped than most workflows: it has canonical phases, aliases, input requirements, preflight expectations, artifact schemas, mutation behavior, evidence boundaries, stop conditions, and regression cases.

The main design constraint is that it must be represented as a phase-gated workflow with explicit user progression. Turning it into a single auto-running "pipeline" would violate the skill's safety model and erase the human decision gates that make the audit reliable.
