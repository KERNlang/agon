# Slice 5 exact-subject adjudication — `3082a886`

Subject: `sha256:3082a8868151704f104d5e59aac1e3e764f0dd598341bfaea4e4e8173275a4a5`

The two-engine Tribunal and independent review completed successfully. Every claim was checked against the staged Git subject and local source before disposition.

## Accepted

- GPT-OSS Tribunal returned no locally actionable finding, but its supporting path claims were not accepted as evidence.
- GPT-OSS independent review returned no finding, but its declaration that the diff was metadata-only was source-refuted.
- The staged verifier changes strengthen two acceptance oracles: persisted result readers must match the exact inventory-global contribution ID, and a deliberately reachable disabled mod must make the negative control fail.

## Evidence-refuted

- Both Tribunal engines invented supporting paths or identifiers. GPT-OSS cited engine registries, RAG adapters, persisted readers, rollback code, drift tests, mod-knowledge, and postinstall rollback generation that are absent. Qwen claims concerning `@kernlang/mod-migrate`, `packages/mod-git-actions/src/policy.ts`, `slice5-test-rollback-1234.json`, `packages/mod-kernel/src/rollback.ts`, `rag-adapter-v2`, and a `rollback_strategy` field cite identifiers, paths, fixtures, or requirements absent from the staged subject and repository.
- Qwen independent review cites `src/auth.ts:42`. No `src/auth.ts` exists in the repository or staged diff.

The refuted claims require no code change. The executed exact-mapping and negative-control gates remain authoritative. No locally actionable review finding remains.
