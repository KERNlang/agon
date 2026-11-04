# RAG embedding owner

Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.
Scope: one RAG-owned sidecar invocation/parser; Core public compatibility
exports and physical workflow use that owner. No new dependency or model download.
Full modular acceptance is not claimed. Final repository gates passed.

Compatibility: Core retains null-on-failure and raw metadata. Physical callers
retain detailed errors and String/Number metadata coercion. Legacy preparation
exceptions now also return null. Existing weak vector validation and separate
physical/legacy chunking remain outside this ownership slice.

## Evidence index

Durable local archive: `/Users/ra/dev/modular-agon-remediation/`.
Each run below has a `.log` and `.receipt.json`; hashes refer to logs.

| Run | Evidence | SHA-256 |
| --- | --- | --- |
| rag-embedding-main-baseline-20261102 | Build/types/full suite/lint/guard: 12,451 passed, 7 skipped | 8f45bd6e0ce2d7e1aec78bb77dad7b58faadbcf6491c17470c57a6801ba0dc06 |
| rag-embedding-generated-export-repair-20261102 | Generator/build/types, 28 focused tests, release set and SBOM generation | 537488059c79bcf6860666b8cccaf980387a2c938684f912b484c2cbfec4fab2 |
| rag-embedding-packed-consumer-20261102 | Packed runtime/types, missing-declaration negative control, exact facade exports, real sidecar execution and timeout | bbaaf74d47ac5d05250aeced4c3818b636437cd283b0fc5977af0bd7f496153e |
| rag-embedding-final-gates-20261102 | Build/types, 12,465 passed / 7 skipped, lint, reexport guard, generator drift, release/supply-chain checks and self-tests | 3070241dc192b3e5896f3ebe13a8ac3485b7a2b7ec4811736a9e6eb3e97adb6b |
| rag-embedding-final-packed-runtime-20261102 | Final packed index/query with executable sidecar, public types and missing-declaration control | 37d3e40d7885b4a17f1896934bcaa8ff0990fed76fe03d8a2ea8b2a1ae55833f |

All listed runs recorded zero provider launches. Fake executable sidecars prove
registered index/query, denied indexing without launch, and prior-index retention
after a failed forced rebuild. The packed check uses existing local builds for
other workspace dependencies; it is not a clean distribution-install proof.
Tarball: `rag-embedding-owner-packed-20261102.tgz`, SHA-256
`021aa20f59c08aed287266e2a9363480b45bd1f01ee3dfd34a1ff89b15c4e9ef`.
Reproduction helper: `rag-embedding-packed-check.mjs` in the archive.

## Independent review and corrections

Isolated Agon Codex review found no introduced production defect. Source packet
SHA-256 `080cab2fd5ccbd2881580d8b926191044c1178e113e3e37551bb7ebef2c2c209`;
review log `rag-embedding-owner-codex-review.log`, SHA-256
`c5532e3979b9ebae1e801cd1e9a9fae5c205316ddd35043a0834f918b714f63c`.
Two confirmed coverage gaps were closed locally: exact five Core exports with
missing/type-export controls, and packed-consumer resolution with a missing-file
control. No second model review was used to substitute for those tests.

The first focused command missed npm's executable PATH; the corrected command
reached the expected missing-module failure. A subsequent build caught the
generated index losing embedding exports. The generator template was repaired
and the successful run above regenerated and built it. Failed receipts remain
in the archive; they are not counted as successful behavior tests.

Release metadata uses the local Node26/npm11 toolchain. Canonical Node22/npm10
archive reproduction and the wider native-platform/provider release matrix remain
separate qualification limits. No integrity check was weakened.
