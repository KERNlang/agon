# KERN 4.5 Runtime Adoption

**Status:** Implemented; final release gate pending  
**Date:** 2026-07-13  
**Confidence:** 0.95

## Goal

Adopt the useful runtime surfaces already published in KERN 4.5 without replacing Agon's proven execution paths: seed fresh Cesar sessions with the cached compiler-derived context spine, enforce honest KERN portability regression gates, certify Agon's persistent RAG storage against KERN's vector-store contract, and prove one contained pure policy through KERN's TypeScript-free source runner. Fix the concrete terminal-output truth defects found by the preceding Agon reviews in the same release train.

## Verified claims

- **VERIFIED:** `@kernlang/cli`, `@kernlang/core`, and `@kernlang/test` resolve to 4.5.0 in this worktree.
- **VERIFIED:** `buildKernContextSpine` is promise-deduplicated and cached per working directory by HEAD plus a five-minute TTL; it is best-effort and already seeds Forge and Conquer.
- **VERIFIED:** fresh Cesar sessions currently assemble `scanProjectContext` and `buildCodebaseMap`, but do not await or inject `buildKernContextSpine`.
- **VERIFIED:** the synchronous `buildCesarSystemPrompt` is reused by session creation, fallback dispatch, and context-budget estimation, so the prepared spine must live in Cesar state and be rendered by this common builder.
- **VERIFIED:** the current native KERN test run passes 183 cases but reports 100% coverage over zero coverable transition/guard/route/tool/effect nodes. Read-only probes against the existing ThinkChain and ReplState machines establish a non-vacuous 15/15 transition gate using explicit reachability paths plus `expect preset=coverage`.
- **VERIFIED:** `kern self-coverage packages --canonicalize-braces --json` currently reports 414 files, 2,357 handlers, 28.55% native-authored, 73.70% classified-or-migratable, 620 blocked handlers, and zero parse-error files.
- **VERIFIED:** `kern self-coverage` has no built-in baseline comparison or threshold flag, so Agon needs a small comparator over a committed, configurable policy file.
- **VERIFIED:** Agon's RAG index persists `manifest.json`, `chunks.jsonl`, and a row-major `embeddings.bin`; current CLI, Cesar grounding, and MCP consumers depend on that API and format.
- **VERIFIED:** KERN 4.5 publishes the `kern-rag-vector-store-conformance-v2` sync/async adapter contract and a 14-case conformance suite covering runtime shape, ranking, batch operations, isolation, dimension/fingerprint failures, deterministic snapshots, clear, and durable reopen.
- **VERIFIED:** KERN 4.5 publishes `@kernlang/core/runner`, a TypeScript-free source executor with explicit fail-closed capabilities. A pure contained policy is suitable; filesystem, network, approval, and mutation policies are not.
- **VERIFIED:** preceding Agon reviews identified reproducible output defects in paragraph/inline deduplication, unclosed reasoning tags, escaped-pipe table parsing, future relative timestamps, EOF headings, lexicographic round ordering, and negative progress widths.

## Implementation contract

### A. Cesar context-spine startup

1. Add an async preparation seam that obtains `buildKernContextSpine(cwd)` only when creating a fresh Cesar session.
2. Store the result on `CesarState`; keep `buildCesarSystemPrompt` synchronous and place the optional compiler map immediately after the codebase brief.
3. Fail open on empty/error results and never rebuild it for an already-live reusable session.
4. Add deterministic tests using an injected spine builder; no unit test may spawn the real KERN context process.

### B. Honest KERN regression gates

1. Commit the native warning baseline and run native KERN tests with coverage enabled.
2. Add native reachability tests for the existing ThinkChain and ReplState machines, require 100% over the resulting non-zero transition surface, and remove the wrapper's `--pass-with-no-tests` escape so deleting all native tests fails.
3. Add a compact self-coverage policy and comparator. Fail on parse errors, native-handler count or classified percentage regression, increased blocked handlers, any new blocker category, or any blocker-category ceiling increase; accept equal or improved reports. Native count replaces native percentage so an explicitly declared host adapter cannot fail solely by enlarging the denominator.
4. Put the self-coverage gate in the root test chain so normal local and CI verification inherit it.

### C. Persistent RAG adapter conformance

1. Add an adapter over Agon's current persistent artifacts; do not replace `buildRagIndex`, `queryRag`, or their clients.
2. Give conformance namespaces independent backing paths so current corpus pruning cannot violate namespace or durable-reopen cases.
3. Map Agon chunk provenance to KERN citations/metadata without losing source and line-range information.
4. Run KERN's published conformance suite in focused tests and fail closed on any failed or skipped required case.

### D. Direct source-runner pilot

1. Add one small pure, deterministic KERN policy entry with no filesystem, network, storage, LLM, approval, or mutation capability.
2. Execute its source through `@kernlang/core/runner` in a focused compatibility test and compare it with the compiled Agon function on a boundary-case matrix.
3. Do not route production safety decisions through the preview runner in this release. Promotion requires a later latency/parity decision with its own spec.

### E. CLI output truth fixes

1. Deduplicate only exact adjacent streaming artifacts; preserve intentional repeated paragraphs and non-identical prefixes.
2. Strip both closed and unterminated reasoning blocks without deleting ordinary answer text.
3. Parse escaped Markdown table pipes as cell content.
4. Render future timestamps truthfully, strip headings at EOF, sort round numbers numerically, and clamp progress inputs before string repetition.
5. Add a focused regression test for every corrected edge.

## Ambiguities resolved

- Native KERN coverage is presently structurally empty. This release makes it honest by covering two existing machines and enforcing a non-zero 100% transition baseline; it does not claim that transition coverage measures every raw/foreign handler.
- The RAG adoption is conformance-first, not a storage rewrite. The wrapper protects current retrieval behavior while making replacement decisions evidence-based.
- Direct source execution is a compatibility pilot only. Running approval or mutation policy through a preview runtime would expand risk beyond the user's request for smoother autonomy.

## Non-goals

- Publishing KERN, consuming unreleased `kern-lang` changes, or changing Agon's package version.
- Replacing Agon's embedding model, chunker, retrieval scoring, CLI/MCP interfaces, or stored user indexes.
- Moving filesystem/network tools, permission checks, or mutation authority into the KERN source runner.
- Weakening existing Cesar permission boundaries or forcing Nero, Tribunal, Brainstorm, Forge, or other modes.

## Acceptance gate

For every independent slice: focused tests, strict KERN compile where KERN source changed, and `agon review uncommitted -e claude,codex,agy`; resolve verified findings before its signed commit. Final acceptance requires strict compile across all workspaces, native KERN tests plus self-coverage regression gate, full TypeScript suite, TypeScript 6 typecheck, production build, final full-roster Agon review with no verified blockers, one branch push, and `npm run install:cli` followed by path/version verification of the linked `agon` binary.

## Implementation evidence

- `c644f9cf` seeds fresh Cesar sessions with the cached KERN context spine; focused review `review-1783976413258-ouukna-kern-4-5-context-spine` returned zero verified findings.
- `de97e346` adds non-vacuous native coverage and strict self-coverage gates. Current native coverage is 15/15 transition units (100%); current self-coverage is 676 native handlers, 73.93% classified/migratable, 620 blocked handlers, and zero parse-error files.
- `1c21b4bf` adds the durable namespaced RAG adapter, passes all 14 published KERN 4.5 conformance cases, and adds a pure source-runner parity pilot. The repeated full-roster passes drove durability, locking, true cosine, corruption, path-confinement, and safe-default fixes; the commit-boundary review returned zero verified findings.
- `5249cd5a` fixes the output-truth edge cases plus negative/non-finite arena crash paths. Fifty-nine focused tests pass; review `review-1783981767811-d19fas-cli-output-truth-final` returned zero verified findings.
- Every implementation commit uses the required Agon KERN authorship and signature. Repository-wide compile, tests, build, branch review, push, and linked-binary verification remain the final release gate.
