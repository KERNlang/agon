# Research DNS cancellation qualification

Status: clean build, runtime, performance and sustained load passed. Not release acceptance.
Runtime subject: `19f8adf0c5b7fae3acc9b3c70bfa8e87f2797298`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.

## Behavior and scope

Research stops waiting for DNS on caller cancellation or the existing request
deadline. Native DNS can finish later; its outcome cannot resume abandoned work.
Abort listeners are removed on success, failure and cancellation. Invocation checks
prevent later selection, ranking, drafting and citation work after cancellation
at those boundaries. Ordinary source-fetch failure retains its fallback.

Only Research's payload changes among the 49 modular packages, plus the launcher.
No dependency, public result format, manifest or catalog changes. Address filtering
and transport repairs in PR366 are separate; this subject does not include them.

## Evidence index

Archive ID: `modular-agon-remediation`. Raw logs remain outside shipping packages.
SHA256 values bind the named files. Tests use isolated fixtures and no providers.

| Artifact | Result | SHA256 |
| --- | --- | --- |
| research-cancellation-main-red-20261030.log | Two failing-before controls | f7768a50b814af2516140bff244b44dce4ef03c2bbcb3e411ee75e7b40e291c8 |
| research-cancellation-selection-red-20261030.log | Ranking after cancellation reproduced | 9b3e5c5f62b7d5564af007355290a6a11fd918864a37318fc2530732d4577653 |
| research-cancellation-checked-20261030.log | 65 focused tests and package types pass | e1d107c01222d2bac20110cf39b850ddfd4786755468814b9c2dceb6ebcab05f |
| research-cancellation-built-20261030.log | Built module settles before DNS release; no late dispatch | 9cfe901d86cc3b99a38544f33a48fc47bcf836d419db05caa3a3811c8e9394a5 |
| research-cancellation-build-continuation-20261030.log | Release/SBOM,types,lint,reexports pass | 06ecd5b60d8b61efbb707600f9c62738719bfe107a55aceb0ebe9a67e2d2fcf7 |
| research-cancellation-full-runtime-20261030.log | 12,125 tests, 7 skips; 129 installed checks; zero providers | 3c1d5a043f12213bd0e7c498d68c80e0f708fd51b4d18da096c3522e99348bfa |
| research-cancellation-clean-build-20261030.log | Exact clean commit; offline locked install, build, types, lint, reexports; zero providers | 07ed49be6000c3a07f15267fed836d502713efd8eeb12d123e320fcc51c87eff |
| research-cancellation-clean-runtime-20261030.log | Exact clean commit; 12,125 tests, 7 skips; installed-package checks and 31 compiler diagnostics pass; zero providers | 3574fa03f7a07ac728f86802866b31a7593625018468b77b386d1ab5622a39f6 |

An earlier aggregate build attempt failed after compilation because its command
omitted the durable offline cache. Preserve that failed receipt:
research-cancellation-full-build-20261030 (log SHA256
4f7932f10f1019e875424c783cab84bc9e55ab698c3f326eec6637ed6844b5ec).
Continuation supplied the verified cache without downloads or source changes.

Performance/load log: `research-cancellation-clean-perf-load-20261030.log`.
SHA256: `183f1069eaf8fc8dfc395455683936197f425cabb8f4fdf73677cd6060b4be6f`.
All eight performance suites and both sustained-load phases passed on the exact
runtime commit. Clean Git before/after; no provider launches. Source contamination
check returned empty ignored, untracked and unstaged source lists.

## Independent review

Isolated Agon Codex input SHA256:
`e820810cd74fb25680f695da93428f01b63959a60131dc0dc9e2fb8d5f2eb5a0`.
Review log SHA256:
`d1d0b1404b66370358ebfc6440446f98ca673135212786007d55678835b4b3b2`.
No introduced DNS defect found. Added the requested synchronous resolver failure,
pre-microtask abort and resolve/abort race tests, plus late-continuation drain.
The resulting 68 focused tests passed; full suite above includes them.

Review also identified late cancellation during receipt/run persistence and failure
of finish inside the catch. Source and a controlled diagnostic confirm late-abort
success, but its correctness depends on whether the result is already committed.
Immutable receipts cannot be undone with an abort check; finishing twice could
overwrite status. Separate investigation retains this finding. This fix does not
claim complete finalization cancellation or all Research lifecycle acceptance.

## Reproduction and limits

Use the exact runtime commit, a locked offline installation with scripts/audit
disabled, and isolated homes/caches. Run build,typecheck,lint,guard:reexports,
test:modular-release,test:modular-supply-chain,npm test,then
`node scripts/spec/verify-modular-npx.mjs --no-write`. Keep providers blocked.
The built DNS diagnostic uses controlled DNS and HTTP, not public networking.
Measured environment: macOS arm64,Node26.12.1. Other native/Node targets and full
original modular acceptance remain unqualified by this slice.
