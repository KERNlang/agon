# Native Browser Host authority

Qualified subject: `753c4423498eefbf012b2aff6e9bade80464facd`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Runtime change: `9178429cee6111a1029e165448c0d3d07041db1f`.
The qualified subject adds only the contention-test synchronization correction.
This index is a later documentation-only commit, not the tested source subject.

## Behavior and scope

The native-messaging launcher now initializes the existing modular authority.
Pairing holds a generation lease and refuses disabled or stale Browser access.
It checks authority immediately before detached spawn and again before returning
a connection token. Successful replies include the selected generation.
Disconnect drains active work, skips queued requests and disposes authority.
Bootstrap rejection produces a protocol-1 error frame.

Shared pairing, framing parsers, origin selection and connection reuse remain
unchanged. No dependency was added. All 49 modular package payloads, versions,
package-json hashes and dependency lists match the base. Launcher payload changed;
its file count increased from 137 to 139 because of shared build chunks.

## Verification

One exact clean committed checkout passed offline locked installation, build,
types, lint, re-export guard, release-set/SBOM/roadmap checks and their included
self-tests, the full suite, installed-package checks and real compiler checks.
Final source-contamination arrays were empty; Git remained clean.

- Full suite: 12,118 passed, 7 skipped, 713 passing files and one skipped file.
- Installed qualification: 129 checks, 15 installed packages; cache deletion and
  idempotence passed. This is not a claim that all 49 packages were installed.
- Supplemental compiler integration: 31 checks passed.
- Eight performance suites passed on macOS arm64, Node 26.12.1.
- Sustained load: 29,480 transport outputs and 712 workflow outputs verified;
  workflow concurrency four. Failure, cancellation, cancelled-engine cleanup,
  recovery, shutdown and host-file cleanup controls passed.
- Zero real provider launches in every referenced harness run.

Six launcher subprocess cases cover enabled, disabled, stale between requests,
corrupt bootstrap, pair-lock contention across generation changes, and disconnect
with queued work. Assertions include exact errors, complete frames, no forbidden
spawn, graceful exit and no remaining active leases. Effects use local fixtures.

## Negative controls and review

Before correction, disabled pairing released a synthetic token. The enabled
control passed while the disabled assertion failed. Isolated Agon Codex review
then identified stale detached spawn during synchronous lock contention and
queued work after disconnect. Both reproduced before their fixes (two failures,
four passing controls). The implementation checks the actual spawn boundary and
queue admission rather than copying the pairing implementation.

The first clean full run on `9178429ce` failed a test synchronization race.
Lease-file visibility preceded release of the lease writer fence; generation
mutation could fail with `MOD_HOST_BUSY`, and teardown hid that original error.
A controlled 750ms writer-fence delay reproduced this. The corrected test waits
for actual pair-lock entry after lease acquisition returns. The same forced
window then passes. Timeouts and production behavior were not weakened.
Removing only the production spawn guard still fails the corrected test at its
forbidden-spawn assertion. Twenty focused repetitions also passed.

Review input: `native-host-authority-review-input.txt`, SHA-256
`bb0b25f0d6208104370c12bfca976afe1c1fb524b346854716f7780ad61752a8`.
Review output: `native-host-authority-codex-review.log`, SHA-256
`25fb93b286162089a994b5c2d6697c0cbe7994acf2ab2d4a862b0c0dd90f7e02`.
Source-verified resolutions are recorded in
`native-host-authority-review-adjudication-20261031.md` in the archive.
No second panel ran after local corrections. This is not the whole-release
distinct-engine review required by the original acceptance roadmap.

## Durable evidence index

Archive: `<operator-evidence-root>/modular-agon-remediation/`, outside Git and
shipping packages. For each run ID, retain `.receipt.json` and `.log` together.
Receipts contain exact commands, exit codes and log hashes. Hashes below were
independently recomputed. Never delete this archive without Raphael's approval.
Failed experiments remain retained; expected failures are not passing gates.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| native-host-authority-red-clean-20261030 | Expected failure: disabled token | `419d1e5b3a6c2bdf499ac8f31f729bf794d5f6e8f6acc52607cf3520f36419a4` |
| native-host-review-red-clean-20261031 | Expected failure: two reviewed defects | `b7fe78ca7c1549a9eb7769b2af87fb08a31336172ba069c4c5c462a56b1fbbd6` |
| native-host-clean-runtime-20261031 | Failed earlier clean run; retained, not acceptance | `17827b7a98e65500c39947373decc219b7884c024100cd7aaf231d6c4d82f7e8` |
| native-host-lease-window-red-20261031 | Expected failure: test writer-fence race | `f2cc7eaeab5a2ec392819b568e58b7b15c59296101a13032710a920d21cf24ba` |
| native-host-lease-window-green-20261031 | Pass under the same forced window | `956c03ed2fa2cade1b320300fa9d3677c592c740ac61536ad44292b4f6ce58a0` |
| native-host-handshake-guard-negative-20261031 | Expected failure: removed spawn guard | `b13208a95ed8b1e808deb962ee65b13380c1a18e05007499f83cf3e39833dc13` |
| native-host-handshake-focused-20261031 | Pass: focused cases, 20 repeats, types/lint/guard | `33214ae41c58e435cb7c9b33aa7b2a78d814fc351d314a81918366568fb29519` |
| native-host-handshake-clean-build-20261031 | Pass: exact clean install/build gates, 228.067s | `55a31028d0be9b20aecc464095ec0a4ad4040139b0faddbea3b7e6e1556d2b42` |
| native-host-handshake-clean-runtime-20261031 | Pass: exact clean runtime gates, 774.872s | `b02b98c6f55098591e6be5d763e32f705c226317953908402fdcb5a7a6b4c9af` |
| native-host-handshake-clean-perf-load-20261031 | Pass: exact clean performance/load, 278.440s | `8ad2ea8cb468f4af899c77d0701329da306f752a8584e28a84817947bbdb05d7` |

Reproduction uses the repository's existing commands: frozen offline `npm ci`
with scripts/audit disabled, `npm run build`, `npm run typecheck`, `npm run lint`,
`npm run guard:reexports`, the three release-set/supply-chain/roadmap verifiers,
`npm run test:modular-release`, `npm run test:modular-supply-chain`, `npm test`,
`node scripts/spec/verify-modular-npx.mjs --no-write`, compiler integration with
`AGON_IT=1`, `npm run perf:modular-release`, and `npm run test:modular-load`.
Use isolated HOME/AGON_HOME/XDG/cache roots and provider blockers, not personal
state. Full command vectors and cache inputs remain in the archived receipts.

## Limits

No real browser, extension or live provider was exercised. Strict external
extension response schemas remain unverified. Static import failure occurs
before the bootstrap catch and is not guaranteed to produce a framed error.
PID-only connection reuse and detached server lifetime are inherited behavior.
Separate Browser HTTP authority concerns require their own runtime reproduction.
The legacy forwarding module remains; combined-main ownership and release
qualification are still open. Other native platforms, provider evidence and
publishing remain separate acceptance cells. Global Agon and personal state
were not modified. This qualifies one repair, not full Modular Agon acceptance.
