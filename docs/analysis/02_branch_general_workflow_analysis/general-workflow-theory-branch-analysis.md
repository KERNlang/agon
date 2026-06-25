# General Workflow Theory: Branch Analysis

## Scope

This artifact records a 15-step sequential-thinking analysis of the
`analysis/transformers-pipeline-architecture` branch, focused only on the broader claim:

> The contract-first workflow/pipeline idea can generalize beyond one skill and become a
> useful theory for registry-invokable workflows.

Branch source:

- Repository: `https://github.com/rotwurstesser/agon/tree/analysis/transformers-pipeline-architecture`
- Local checkout: `/Users/mrryf/develop/agon_testing/repo`
- Branch: `analysis-transformers`
- Verified local/remote SHA: `82a3a2d5e88f2e3afde51d2bbe39dedf2157b6e1`
- Primary branch artifact: `docs/transformers-pipeline-architecture-analysis.md`

## Sequential-Thinking Record

1. The branch already frames the useful idea as reusable contract discipline, not
   chapter-source-auditor-specific mechanics.
2. The Transformers analogy maps to stable public contracts over heterogeneous tasks, not to
   copied ML runtime classes.
3. Agon's verified `pipeline` drift matters generally because plugin/skill routing would
   inherit ambiguity without canonical contracts.
4. Shared workflow fields should be separated from variant runtime semantics.
5. A KERN-derived workflow table can host first-party workflows and later skill/plugin
   contracts without forcing every skill to become an Agon mode.
6. The name `PipelineRegistry` is risky because `pipeline` is already overloaded; prefer
   `WorkflowContract`, `WorkflowSpec`, or `OrchestrationContract`.
7. General applicability criteria should include IDs, aliases, surfaces, input/output
   contracts, defaults, runner kind, mutation/apply behavior, artifacts, docs, preflight,
   and parity tests.
8. A general theory cannot require every workflow to be phase-gated identically; it must
   allow explicit-only, auto-detected, script-authoritative, semantic, and mixed workflows.
9. The branch supports "contract before runner extraction" as the safe implementation order.
10. The plugin implication is general: plugins must declare workflow IDs, aliases, inputs,
    mutation behavior, artifacts, permissions, and supported surfaces.
11. The branch proves need and direction, but not sufficiency; cross-skill validation is
    required.
12. General contract fields should include explicit invocation policy, auto-detection policy,
    phase model, artifact lineage, checker authority, semantic authority, and mutation/apply
    behavior.
13. The word `pipeline` is acceptable only if constrained to contract-first workflow registry,
    not universal runtime chain or silent auto-progression.
14. The smallest host-side generalization slice is a contract inventory plus conformance
    checker/report, not a new universal runner.
15. The branch conclusion: direction is sound, but general theory must be validated across
    multiple skill archetypes.

## Branch Facts Relevant To General Theory

The branch recommendation is conservative:

- Do not copy the Python or Transformers.js pipeline runtime/class hierarchy.
- Copy the contract discipline:
  - canonical task/workflow IDs
  - explicit alias normalization
  - central supported-workflow inventory
  - declared defaults and expected inputs/artifacts
  - cross-surface parity tests

This is already a general abstraction boundary. The branch's contribution is not "all
Agon workflows should execute like Hugging Face pipelines." It is "all exposed workflows
need a stable contract that every surface can resolve and test."

## Generalizable Contract Dimensions

A general workflow contract should be able to express:

- canonical workflow ID
- aliases and alias normalization rules
- surfaces that expose the workflow
- invocation policy, including explicit-only or auto-detectable modes
- phase model, including one-shot, multi-phase, inferred-phase, and manually gated variants
- required and optional inputs
- output artifacts and artifact lineage
- runner kind and deterministic helper hooks
- evidence policy
- semantic authority boundary
- mutation/apply behavior
- protected roots and allowed write roots
- permissions/capabilities
- preflight expectations
- stop conditions
- next allowed invocation
- docs label and generated inventory entry
- parity tests across CLI, slash, MCP, plan-mode, and plugin/skill invocation surfaces

## What The Branch Proves

The branch proves that Agon needs contract discipline before workflow/plugin expansion.
It verifies that one current workflow label, `pipeline`, already means different things:

- slash/in-session: build -> fitness -> review/fix loop
- `agon call` and MCP direct: brainstorm -> forge -> tribunal
- plan-mode: brainstorm -> forge -> tribunal with a narrower apply behavior

That evidence strongly supports a contract-first registry direction. If first-party
workflows drift today, plugin-provided workflows will drift unless the host validates IDs,
aliases, surfaces, input/output contracts, mutation behavior, and docs from one source of
truth.

## What The Branch Does Not Prove

The branch does not prove that one schema fits all useful skills. It does not inspect
multiple skill designs, compare archetypes, or test phase-gated artifact workflows outside
Agon's own `pipeline` ambiguity.

Therefore the general workflow theory remains a hypothesis after the branch pass:

- Supported: contract-first registry is the right direction.
- Not yet proven: one contract schema can cover other complex skills without becoming a vague
  metadata catch-all.

## General Theory Implication

The theory should be stated as:

> A skill or workflow can be made registry-invokable when its invocation, input, output,
> mutation, evidence, authority, phase, and routing behavior can be declared and tested as a
> workflow contract.

It should not be stated as:

> Every skill should become a pipeline with the same runtime class, same phase shape, or same
> automatic progression behavior.

## Smallest Safe Generalization Slice

The smallest safe next step for general workflow theory is:

1. Define a declarative `WorkflowContract`/`WorkflowSpec` schema.
2. Build a read-only conformance inventory for existing workflows/skills.
3. Classify each workflow into an archetype rather than forcing all workflows into one
   runner model.
4. Add parity tests for ID/alias/surface behavior.
5. Add mutation and checker-authority tests.
6. Only then consider plugin execution or runtime extraction.

## Bottom Line

The branch supports the general direction if "pipeline" means a contract-first workflow
registry with explicit contracts and parity tests. It does not support a universal pipeline
runtime. The general theory must be validated against multiple skills and must allow
different workflow archetypes.
