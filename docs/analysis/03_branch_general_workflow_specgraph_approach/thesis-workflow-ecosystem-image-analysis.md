# Thesis Workflow Ecosystem: Image Analysis

## Scope

This artifact records a 15-step sequential-thinking analysis of the provided workflow image.

The image is treated as an example of a **general workflow ecosystem class**, not as a target
to reproduce exactly. The architectural question is whether a future contract-first workflow
architecture could support systems like this: multiple workflow nodes, artifact handoffs,
external systems, human gates, feedback loops, and final build outputs.

Image source:

- `/Users/mrryf/Downloads/thesis-workflow(2).png`

## Sequential-Thinking Record

1. The image is a workflow ecosystem graph with agents, skills, scripts, external services,
   humans, artifacts, and gates.
2. The acquisition lane produces candidate source artifacts and metadata artifacts.
3. Zotero represents an external metadata system with read/write sync and build-time
   rendering implications.
4. The knowledge-pipeline lane is a stateful ingest/conversion workflow that transforms PDF
   artifacts into Markdown artifacts.
5. The human author node produces target Markdown based on research and summaries.
6. The chapter-source-auditor lane consumes converted sources and human-written content, then
   catalogs, proposes, and verifies.
7. The central chapter-source-auditor node looks like a workflow family, while the three
   phase labels remain separate contracts.
8. The coherence-orchestrator lane reasons over relationships between document artifacts and
   may route source-dependent work back to source audit.
9. The graph has feedback loops and repeated iterations, so cycles need explicit stop,
   freshness, and lineage rules.
10. The content-sync/build lane needs deterministic manifests, citation metadata, and
    reproducible build contracts.
11. The graph has fan-out and fan-in, not just a chain.
12. The graph contains heterogeneous artifact classes: PDFs, Markdown sources, thesis
    Markdown, audit reports, coherence packets, LaTeX, bibliography metadata, and final PDF.
13. The graph separates propose, apply, verify, and human-approval responsibilities.
14. Future chainability cannot mean "run command B after command A"; it needs output
    contracts, import requirements, readiness states, and invalidation.
15. The image is best modeled as `WorkflowGraphSpec` over `WorkflowSpec`s, not chained
    pipelines.

## Generalized Nodes

The image contains these generalized node classes:

| Image Element | General Node Type | Notes |
| --- | --- | --- |
| `@research-summarizer-agent` | acquisition/research discovery workflow | Discovers candidate papers and PDFs; may use external APIs. |
| `@research-summarizer` | source evaluation and metadata workflow | Saves/evaluates papers and creates a research source map. |
| `/zotero-sync` | external metadata sync adapter | Writes source metadata into Zotero. |
| Zotero | external stateful system | Later renders bibliography/source directory for build. |
| `/knowledge-pipeline` | ingest/conversion workflow | Checks, converts, validates PDFs into Markdown. |
| Human author | human authority node | Produces thesis content from research. |
| `/chapter-source-auditor` | semantic audit workflow family | Catalogs, proposes, verifies against sources. |
| `/coherence-orchestrator` | structural coherence workflow family | Catalogs overlap, defines authorities, checks structural amendments. |
| `/content-sync` | content transformation/export workflow | Generates LaTeX or final-form build sources. |
| Build script | deterministic build/render workflow | Renders final PDF from LaTeX and bibliography/source metadata. |

## Generalized Artifact Classes

The graph moves multiple artifact types:

- discovered source metadata
- PDF source files
- Zotero item metadata
- Markdown-converted raw sources
- research source maps
- human-authored thesis Markdown
- source-audit catalogs
- source-audit findings/proposals
- source-audit verification artifacts
- coherence catalogs
- coherence decisions
- coherence packets
- content-sync outputs
- LaTeX files
- rendered bibliography/source directories
- final PDF output

A future workflow architecture needs artifact type declarations and compatibility checks, not
just text prompts passed between commands.

## Generalized Edge Types

The image implies several edge categories:

- artifact transform: PDF -> Markdown
- metadata sync: PDF/source metadata -> Zotero
- human-authored artifact edge: research/source map -> thesis Markdown
- audit input edge: thesis Markdown + raw sources -> source audit
- proposal edge: audit findings -> human-editable amendments
- verification edge: manually edited content -> verification artifacts
- structural analysis edge: content sets -> coherence catalogs/decisions
- handoff edge: coherence source-dependent issue -> source-auditor context
- build input edge: Markdown/LaTeX + Zotero metadata -> final PDF
- feedback edge: previous run artifacts -> next audit/coherence iteration

These edges need contracts:

- source artifact type
- target artifact type
- compatibility schema
- freshness/invalidation rule
- lineage propagation
- permission requirement
- authority boundary
- manual gate requirement
- retry/cycle policy
- failure/blocking behavior

## Why This Is Not A Linear Pipeline

The diagram is not a single pipeline:

- it has fan-out from research/PDF discovery into Zotero and conversion
- it has fan-in into final PDF rendering from content, LaTeX, and Zotero metadata
- it has cycles between human writing, source auditing, and verification
- it has a feedback/handoff relationship between coherence and source auditing
- it has external state in Zotero
- it has manual authorial decisions
- it has multiple artifact classes with different mutation policies

Calling this "chained pipelines" is possible informally, but architecturally the safer term
is:

```text
workflow ecosystem
```

or:

```text
workflow graph
```

## Required Architecture Primitives

To support general systems like this, the pipeline branch would need to evolve into:

```text
WorkflowSpec        # node contract
ArtifactSpec        # artifact type/schema/lineage contract
EdgeSpec            # compatibility and gate contract between nodes
ExternalAdapterSpec # external service/API contract
WorkflowGraphSpec   # graph-level nodes, edges, cycles, gates, permissions
ConformanceReport   # proof the graph is inspectable/safe before execution
```

Minimum graph-level fields:

- graph ID and version
- node references
- edge references
- artifact type registry
- external system registry
- manual gate definitions
- trigger policy
- fan-in/fan-out rules
- cycle/iteration policy
- freshness/invalidation policy
- concurrency/locking policy
- permission and capability policy
- build/reproducibility policy
- graph-level conformance tests

## Safety And Governance Implications

The image makes several governance requirements visible:

- Human decisions must be explicit, not hidden inside automation.
- Proposal, application, and verification are different edge types.
- External systems like Zotero need permission and reproducibility contracts.
- Generated domain outputs must be distinguished from protected source artifacts.
- Previous-run reuse needs lineage and freshness checks.
- Feedback loops must not auto-run indefinitely.
- Build outputs need deterministic manifests and reproducible inputs.
- A graph must fail closed when an upstream artifact is stale or missing.

## Bottom Line

The image supports the direction of the pipeline branch only if the branch evolves from
single-workflow contracts into graph-level contracts. The right future target is not
"chain multiple pipelines together" as opaque command sequences. It is:

```text
contracted workflow ecosystem orchestration
```

where each workflow node declares its contract, each artifact edge declares compatibility
and authority, and the full graph can be inspected and checked before anything runs.
