# PersistentSession contract ownership

Qualified source: `07102df0a47ce4ab3ac344f9ca61f0d021472d79`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
This qualifies one ownership slice, not the complete modular release.

## Scope

Persistence owns the exact `PersistentSession`, `SessionChunk`,
`SessionSendOptions` and `ControlPlaneEnvelopeV1` declarations. Core preserves
its compatibility exports. Five transport modules import the public owner.
Config, factory, transport implementations, validators and fencing stay unchanged.
No dependency was added. The frozen ledger assigns PersistentSession to
Persistence. Envelope co-location is a design decision, not a separately frozen
assignment. Persistence already owns live BrainClient/control contracts.

## Evidence

Raw logs and receipts remain in the operator's durable external
`modular-agon-remediation` archive, not shipping packages. Each run ID below has
`.receipt.json` and `.log` files. Receipts contain exact commands, exit status,
duration and provider-launch records. Listed hashes are SHA-256 of logs.

| Run ID | Result | Log hash |
| --- | --- | --- |
| persistent-session-contract-baseline-20261031 | Baseline gate passed | `0e8baddda5d5cbdc56800f9224b3d15d67454e06fa467b833810406670faf531` |
| persistent-session-contract-red-20261031 | Expected missing owner/export failures | `47ca2aec159618ea04088aaca4baa563e5c010abf1ba7c0b16a310c00fe3fee7` |
| persistent-session-contract-review-fixes-20261031 | Fresh package builds, 36 tests, types/lint/guard passed | `734a306ad0ea6d11efa65959354f44cda424bda71b9a7ef0bf97ad96c86a09cb` |
| persistent-session-contract-stale-dist-negative-20261031 | Removed source export failed despite stale dist | `fa9c67ba9f91390ecf270c340bd9cee9c1687b6c993f7d2cc75c72d11220163f` |
| persistent-session-contract-full-gate-20261031 | Full source gate passed | `41ddfbc39603e48fd0f81a698e47ddf01468c6dabed86e6c4f79757e2eb91ca7` |
| persistent-session-contract-clean-build-20261031 | Exact clean checkout build passed | `1bcb3d7ffdf3cbfa186f8db7a1b64cddfa9b28a7e023461ea2863b6d967cf4f7` |
| persistent-session-contract-clean-runtime-20261031 | Clean runtime/installed qualification passed | `9b0d85e5a209f84fdbe67a6a44683c8340b5a9d95fbfd0bf5d2f47c366e3c7bb` |
| persistent-session-contract-clean-perf-load-20261031 | Native performance/load passed | `3173486151b364d64ed24b48608350fba14cfbab8ccd4b8fc3f7995103fdc04b` |
| persistent-session-contract-clean-contamination-20261031 | Clean subject; no source contamination | `251568c88f600c5f40eb023a0bc6056d0432ccf68b7a5001092b62ba28c3cea6` |

Full source and clean-checkout suites each passed 12,120 tests, with 7 skipped.
Clean qualification also passed 129 installed checks across15 installed packages,
cache-deletion survival, setup idempotence and31 diagnostics including real tsc.
All test receipts recorded zero live provider launches.

The clean checkout installed locked dependencies from an isolated offline cache
with scripts and audit disabled. Release-set/SBOM checks did not regenerate
evidence. Types, lint, re-export guard, roadmap and selftests passed.

Native scope: macOS arm64, Node26.12.1. All configured performance budgets passed.
Two-minute load run verified712 jobs; request p95 8.38ms, peak daemon RSS179,306,496
bytes, settled RSS growth3,260,416 bytes. Pending fixtures0. Failure, cancellation,
recovery and shutdown cleanup controls passed; shutdown34.46ms.

## Review and discriminating checks

Isolated Agon Codex reviewed the bounded source packet. Input SHA-256:
`7920875a7dbeced4ebef08f5b61b74425109b649da0f995d669ee8868c7c03cb`.
Output SHA-256:
`2eebb00f0bdccfa4789e18aefc0d6269646ad4e2b2f7c2690e4d5356047d788f`.
Archive: `persistent-session-contract-review-input.txt`,
`persistent-session-contract-codex-review.log` and corresponding receipt;
adjudication: `persistent-session-contract-review-adjudication-20261031.md`.

No production defect found. Two verified oracle gaps were fixed: source-AST
assertions now detect missing compatibility exports despite stale declarations;
compiler checks cover the historical persistent-session declaration file too.
The envelope relative import proves declaration-file compatibility, not a public
package subpath. Core exports only its root. Fresh clean builds remove stale-output
ambiguity. The negative control removed only the source re-export: one assertion
failed while seven tests, including the compiler probe, passed. Export restored.

The frozen four-interface fixture independently matches pinned Git source.
AST mutations detect missing fields/methods and changed send return semantics.
Public compiler probes check old/new symbol identity and invalid inputs.
All seven changed Core modules emit identical normalized runtime JS to base.
Reproduction script in archive:
`persistent-session-contract-runtime-equivalence-20261031.mjs`, SHA-256
`b445a76aa3e6a905dbe3b47b5c014b8f375012fae4b1aafcf3ac1e20913c2c02`.

## Attribution and limits

Only Persistence payloadHash/file inventory changed among49 target packages.
Other regenerated package archive metadata does not imply source changes.
S4 ledger regeneration includes inherited drift: base generator yields261
occurrences,104 adapters/43consumers; current yields261,105/42. Only
PersistentSession:58 changes disposition against regenerated base. No removal
or inherited ordering/count drift is claimed as new migration progress.

Core runtime extraction and compatibility retirement remain separate work.
Other open PRs are not incorporated. Combined-main acceptance, other native
platforms/Node versions, live providers and publishing/provenance remain unproven
here. No global Agon installation or personal state was modified.
