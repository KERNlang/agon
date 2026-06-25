# Agon Brainstorm Evidence: chapter-source-auditor as Workflow Pipeline

## Run Metadata

- Mode: `agon brainstorm`
- Run path: `/Users/mrryf/.agon/runs/brainstorm-1782413904280-drx7st-chapter-source-auditor-pipeline-`
- Command shape: `agon brainstorm <prompt> -e kimi-code,codex --timeout=900 --label chapter-source-auditor-pipeline-contract --quiet`
- Engines: `kimi-code`, `codex`
- Status: `2/2 succeeded`
- Agon summary: `2/2 bid; winner=codex`
- Confidence bids from `status.json`:
  - `kimi-code`: `confidence=33`
  - `codex`: `confidence=91`
- Source inputs:
  - `.codex/evidence/transformers-pipeline-architecture-branch-analysis.md`
  - `.codex/evidence/chapter-source-auditor-skill-analysis.md`
  - `.codex/evidence/agon-brainstorm-prep.md`

## Prompt Focus

The brainstorm prompt asked Kimi and Codex to analyze whether the `chapter-source-auditor`
skill can become a registry-invokable Agon workflow pipeline using the architectural idea
from the Transformers pipeline branch. It explicitly asked the agents to challenge whether
a `WorkflowContract` table is the right abstraction, identify missing fields and risks,
decide between one pipeline and three phase-level contracts, and propose the smallest safe
implementation slice.

## Kimi Position

Kimi proposed a metadata-first registry made of three block-level `WorkflowContract`
entries, starting with Block 1 only and putting any top-level wrapper behind a `no_auto_advance`
policy.

Important Kimi points:

- The skill is already contract-shaped because each block has explicit inputs, protected roots,
  required artifacts, and stop/next-invocation rules.
- A single executable `pipeline` ID would erase human decision gates and phase boundaries.
- `WorkflowContract` is acceptable as a registry vessel, not as a generic runner factory.
- Deterministic preflight scripts must be distinguished from semantic validators.
- Agon's overloaded `pipeline` family should be resolved before expanding workflow/plugin
  routing.

Kimi's proposed first implementation sequence:

1. Add a workflow contract schema and registry module.
2. Register only `chapter-source-audit.block1.catalog`.
3. Route aliases across call, MCP direct, MCP in-session, slash, and plan-mode through the
   contract table.
4. Add parity tests for pipeline-family surface mapping, protected-root non-mutation, and
   no auto-progression from Block 1 to Block 2.
5. Resolve Agon's internal `pipeline` naming drift before expansion.
6. Register Blocks 2 and 3 only after the ambiguity and Block 1 contract tests are stable.

## Codex Position

Codex recommended making the skill registry-invokable as a metadata-first workflow family,
not as a generic runtime pipeline.

Recommended IDs:

- `chapter-source-audit.block1.catalog`
- `chapter-source-audit.block2.adjudicate`
- `chapter-source-audit.block3.verify-integration`
- Optional wrapper: `chapter-source-audit`

Important Codex points:

- The wrapper should be discoverable but initially non-executing.
- The wrapper may explain valid phase invocations but must not run Block 1 -> Block 2 -> Block 3.
- The Transformers branch supports contract discipline, not a copied ML runtime hierarchy.
- The existing Agon `pipeline` drift is a warning that registry workflow IDs must reduce
  ambiguity rather than add another overloaded route.
- Deterministic scripts should report structural status only, never semantic source-truth
  verdicts.

Codex's minimum field set for Block 1:

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
- `deterministic_checkers`
- `required_artifacts`
- `semantic_authority_boundary`
- `stop_conditions`
- `next_invocation`
- `human_or_agent_review_required`

## Agreements

Both agents agreed on the core direction:

- Yes, the skill is a plausible vessel for registry-invokable workflow contracts.
- The correct shape is three phase-level contracts, not one auto-progressing executable
  pipeline.
- A top-level `chapter-source-audit` wrapper can exist only as discovery/routing metadata
  at first.
- The first safe implementation slice is Block 1 only.
- The registry must preserve explicit invocation, phase gates, mutation boundaries, evidence
  boundaries, and deterministic-checker limitations.
- Existing Agon `pipeline` ambiguity must be addressed or isolated before broader workflow
  plugin machinery depends on it.

## Tensions And Challenges

Kimi emphasized safety and existing `pipeline` drift more strongly. Codex emphasized a
discoverable top-level family entry for ergonomics. The synthesis is to allow the wrapper
for discovery but keep execution restricted to explicit phase-level contracts.

The biggest unresolved design risks are:

- `WorkflowContract` becoming a vague metadata catch-all.
- Registry invocation bypassing explicit `$chapter-source-auditor block=...` intent.
- A top-level `pipeline` label encouraging unsafe auto-progression.
- Structural checker `PASS` being mistaken for semantic audit success.
- Mutation behavior being under-specified, especially around thesis, `_raw`, protected roots,
  previous-run roots, and generated run artifacts.
- Cross-surface routing continuing to mean different things for slash, call, MCP direct,
  MCP in-session, and plan-mode.

## Brainstorm Conclusion

The brainstorm supports the architectural idea, with a hard constraint: implement the
`chapter-source-auditor` as a registry workflow family, not as a monolithic executable
pipeline. The smallest safe slice is a declarative Block 1 contract plus a non-executing
family wrapper and parity tests for explicit invocation, alias normalization, write policy,
structural-only checker status, and no auto-advance.
