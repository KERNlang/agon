# Research status retention

Runtime subject: `a6f8fdff11bb2d1a49727b58d1a63d18f1a3453b`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Status: clean build, runtime, performance and load passed. Not release acceptance.

## Defect and repair

A status-write failure made Research submit a second, failed outcome. The CLI
host then retained that second outcome for exit recovery, replacing a successful
result with failure. A real isolated storage obstruction reproduced submissions
`[true, false]` and recovery with `ok: false`.

The repair marks the original outcome as submitted before calling the existing
host. Errors after submission propagate without a second finish. Ordinary
discovery failure still finalizes once. This reuses Forge's submission-guard
pattern; it does not change the host, dependencies, manifest, public API, storage
format or cancellation policy. Only Research's payload changes among the 49
modular packages, plus the launcher. Other tarball metadata is regenerated.

## Evidence

Archive ID: `modular-agon-remediation`. Raw evidence remains outside shipping
packages. SHA-256 values below were checked against the retained files.

| Artifact | Result | SHA-256 |
| --- | --- | --- |
| research-status-recovery-red-20261030.log | Real CLI persistence reproduced overwritten success | 15fa600d748e84f5b5a90d61f2a8b2e3e632a61868fdafc6f41355af9bb24b84 |
| research-status-retention-final-focused-20261030.log | 60 focused tests pass | 7417ce79a91db6e409c051abc69bc32fe906b7ed6054903be0a30cc839022a53 |
| research-status-retention-full-build-20261030.log | Build, types, lint, reexports, release-set and SBOM pass | d3838129fb1c17e0cbaf44543073a1ba4ded9fb8972e6ccb8831fd1620a8b4b0 |
| research-status-retention-full-runtime-20261030.log | 12,117 tests, 7 skips; installed checks pass | 4ee6b31b1ef253c9b96338912896b318e533da407fb786e5b10af9402ab35cd6 |
| research-status-retention-clean-build-20261030.log | Exact clean commit, offline locked install and build gates pass | 01dc0462df978b07ff124d6912e681982a47c8fe8917050a98370f6554875a0f |
| research-status-retention-clean-runtime-20261030.log | Exact clean commit: 12,117 tests, 7 skips, 129 installed checks and 31 compiler diagnostics pass | 43f605b7d94ca05896a7400b8be5c591af5c0439a92a27b93d6fdcc5a1084aa0 |

Installed checks cover 15 packages, cache deletion and setup idempotence. Runs use
isolated state and blocked providers; every completed gate reports zero provider
launches. Clean checkout source-contamination lists were empty before/after build
and after runtime/load qualification.

All eight performance suites and both two-minute sustained-load phases passed.
Log: `research-status-retention-clean-perf-load-20261030.log`; SHA-256:
`e9fa17a3a0b7601b44d01767158ab16048084ebdba0e267fa209033c8cfffc9c`.

## Independent review

Isolated Agon Codex input SHA-256:
`1e24f6459572efc7694040c666f6ede9b50bfeb9d8d0b5369cb3bddf66da350d`.
Review log SHA-256:
`12e526cd4a3d8a7c43525dd1682cb573837157d95ea220e2e4946a0ef1af0b80`.
Files: `research-status-retention-review-input.txt` and
`research-status-retention-codex-review.log` in the archive.

No introduced defect found. Added requested post-publication coverage: the real
host writes status, then a wrapper throws. Tests retain exact published bytes and
the same exception. Together with pre-publication obstruction, both success and
failure outcomes are covered. These are not fsync fault-injection claims.
The full suite exercises exit-listener cleanup and ordinary discovery failure.

## Reproduction and limits

Use the exact runtime commit with isolated homes, locked offline dependencies,
install scripts/audit disabled and provider blockers. Run `npm run build`,
`npm run typecheck`, `npm run lint`, `npm run guard:reexports`,
`npm run test:modular-release`, `npm run test:modular-supply-chain`, `npm test`,
then `node scripts/spec/verify-modular-npx.mjs --no-write`.

Measured environment: macOS arm64, Node 26.12.1. Other native platforms and Node
versions are not qualified by this slice. Independent of PR366 and PR367.
Late cancellation after publication and combined execution/persistence error
reporting remain separate concerns. Full modular acceptance requires the original
aggregate receipts and reviews; this bounded repair does not replace them.
