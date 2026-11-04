# Naturalize legacy workflow owner

Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.
Branch: `refactor/modular-naturalize-workflow-owner`.

The legacy algorithm, prompt builder, fence cleanup and result type now live
in `mod-naturalize/src/workflow.ts`. Forge retains its public options type,
full EngineRegistry API and a thin binding. No new dependency or version.
The binding injects the existing Core text scanner and cleaner: replacing
them with the physical sanitizer would change Unicode handling and reports.
The physical command loop remains separate; this is not complete consolidation.

## Verification

Raw logs and receipts: `/Users/ra/dev/modular-agon-remediation/`.
Run IDs identify `.log` and `.receipt.json` files. No evidence was deleted.

| Run | Result | Log SHA-256 |
| --- | --- | --- |
| naturalize-owner-baseline-20261101 | Baseline passes; 12,451 tests, 7 skipped | c966a163a6dc7e90d256fb3c1aedda4ab7d20a5ad722679aa3cde9e622ff58cd |
| naturalize-owner-red-20261101 | 38 pass; missing owner fails before move | c092a150003961b805ca77f8b1fe6a7e5d604a0ca4278f22e464137772121fcb |
| naturalize-owner-duplicate-negative-20261101 | Restoring old implementation fails ownership test | 426071d1d2af6b7cef3bfbdc329d6a8174ad2b6cac02078fae0d18ad3d836e80 |
| naturalize-owner-restored-20261101 | 59 focused tests and types pass after restoring facade | 00d1ef39e4bf30d62db99581d546c0cde02b4d4add15331360f36b3ae2464485 |
| naturalize-owner-full-20261101 | Rejected: three generated catalog drift failures | c42e26538b2047d8ab8bc6c78fb1a8c4ac6d661c5738864ca48fa63f645f24f5 |
| naturalize-owner-catalog-20261101 | Focused catalog and Naturalize checks pass | 3a5cb71bc21ed7db7ff17f797ba8e88d9e09bd5ff91a5c656020d4124b0f69ca |
| naturalize-owner-qualified-20261101 | Full gate passes, 965.309s; 12,454 tests, 7 skipped | 9f2040288c61ba5aaab1490f3885bba5ba371a3fd5854a46d1f0fbc2458e6659 |
| naturalize-owner-final-built-20261101 | Final compiled compatibility probe passes | 443500765c9546b25557ec6ddd8bef45ce57ee0ccf73e22e3b9d1d27dc5de9b1 |

Full gate covers package/ledger/catalog drift, build, mode docs, release-set,
SBOM, types, all tests, lint, re-export guard, modular release, supply-chain
self-test and diff check. Every run used isolated state and zero live providers.
The final built Forge entry probe makes two calls with two fake dispatches;
it verifies prompt identity, text-only dispatch, Unicode cleanup, retry,
fence removal and author refusal. It is not a live-provider qualification.

Compiler checks retain public registry load/register/list methods and reject
incomplete registry/result shapes. Existing behavior assertions are unchanged.
Exact AST function bodies match the base: workflow SHA-256
`51ca6f7c1cfb994d51b53ba18d5112148fa00a45b21b7f3d810a265e14aa769a`,
prompt `3911c2c14099010395af4edbecc2be21f69bc0e0d74bf4bbb051e6f134d0b761`,
wrapper `cc7aa056871b88ecb8b75009ddde2c54dba0355c7723fc06bcef45e17b9b636c`.

Isolated Codex review found no blocking regression. Packet SHA-256:
`328d583e73d2ba01b253a2117e63df670f297ae2e7a1048d7ec58bc687348b37`;
review log `a076b4687be67cd2b68b45628b80ba91b7a978d3962011ff6641a2a31235167b`.

## Generated artifacts and limits

Adding the workflow pack entry changes the Naturalize manifest. The first
full run correctly rejected two stale surface owner hashes. Regeneration
changed only those hashes; predicates and tests were not weakened. The final
gate checks catalog drift before expensive tests.

Naturalize and kernel payloads change among the 49 modular packages. The
launcher bundle also changes; the dedup compatibility artifact changes only
archive metadata. The S5 ledger records the result definition's exact owner
while retaining historical compatibility and authority labels.

Physical Naturalize loop and text-forensics consolidation, integrated release
receipts, and unavailable platform/provider evidence remain open. This is a
bounded owner move, not full Modular Agon acceptance or permission to install.
