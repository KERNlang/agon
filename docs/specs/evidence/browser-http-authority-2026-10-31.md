# Browser HTTP admission authority

Qualified runtime commit: `7fd152897fc9056c07fdbe8f81664356e6a83754`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Branch: `fix/modular-browser-http-authority`.

## Behavior

`AgonServe.handleSend` checks captured host authority and the existing `serve`
surface after waiting for the session queue, before provenance or brain entry.
Stale requests return HTTP 409; disabled requests return HTTP 403. Active turns
retain cancellation and natural completion. Downstream brain errors remain
HTTP 500. Existing Jobs error mapping is shared, not duplicated.

No dependencies changed. All 49 modular package payload, metadata, dependency
and version fields match the base. The launcher payload changed; its inventory
remains 137 files. Generated release-set, SBOM and channel metadata were rebuilt.

## Qualification

An exact detached checkout passed locked offline installation with scripts and
audit disabled, build, typecheck, lint, re-export guard, release-set and
supply-chain checks/self-tests, roadmap verification and the full suite.

- 12,118 tests passed; 7 skipped. No skipped test is counted as passing.
- 129 installed-candidate checks across 15 installed packages, including cache
  deletion and idempotence.
- 31 compiler diagnostic tests, including a real compiler failure fixture.
- All eight release performance measurements passed on macOS arm64,
  Node v26.12.1.
- Sustained daemon transport and fixture Think load passed. Workflow phase:
  712 verified outputs, peak fixture concurrency 4, zero pending fixtures.
  Failure, cancellation, recovery, shutdown and process-cleanup controls passed.
- Git was clean at qualification exit. Source-bearing ignored, untracked and
  unstaged contamination lists were empty before install and after qualification.
- Every archived run below recorded zero real provider launches.

The load gate measures daemon transport/workflows, not Browser HTTP throughput.
The Browser behavior evidence is real loopback HTTP with a fixture brain.

## Regression discrimination

Six tests in `tests/unit/modular-browser-http-authority.test.ts` cover enabled
admission, disabled boot, stale and queued admission, replaced host authority,
downstream error mapping, cancellation and natural completion. Rejected requests
must not invoke the brain or append provenance. Existing bridge and Jobs tests
remain unchanged.

The initial reproduction failed on stale and disabled admission. Moving the new
check before `await prev` makes the queued request succeed incorrectly and fails
the regression. An intermediate broad error catch broke an existing typed brain
error test; the final implementation limits mapping to authority catches. That
failed run is retained, not presented as accepted evidence.

Reproduce the focused checks after isolated locked install/build:

```sh
node node_modules/vitest/vitest.mjs run tests/unit/modular-browser-http-authority.test.ts tests/unit/agon-serve.test.ts tests/integration/serve-jobs-authority.test.ts
```

Full commands are preserved in each receipt. Standard gates are `npm run build`,
`npm run typecheck`, `npm run lint`, `npm run guard:reexports`, `npm test`,
`npm run test:modular-release`, `npm run test:modular-supply-chain`,
`npm run perf:modular-release`, and `npm run test:modular-load`. Installed checks
use `node scripts/spec/verify-modular-npx.mjs --no-write` with the existing
qualification caches. Compiler checks use `AGON_IT=1` for diagnostic-runner.

## Durable evidence

Archive locator: operator-owned `modular-agon-remediation`, outside Git worktrees.
Each run ID below identifies a `.receipt.json` and `.log` pair. Receipts retain
commands, exit codes, elapsed time, hashes and provider-launch records. Retrieve
by run ID and verify the raw log against SHA-256 below. Original failed evidence
is retained. Never delete the archive without Raphael's explicit approval.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| browser-http-authority-red-20261031 | Expected failure | fe7c8d9ee1a529f49050c17d13b6dc2752aa70cc5a71c05d1a8e218f9ca7b72b |
| browser-http-queue-guard-negative-20261031 | Expected failure | 8c1c884acec884dce4877326b14e2590b6366d58f427668144f3ef7707377d13 |
| browser-http-authority-restored-20261031 | Intermediate regression | 2f19876a3250e55f0c00c3eb3aa381640e70c21525710757ed9a789864b3a57f |
| browser-http-review-controls-20261031 | 43 focused tests and quality gates passed | 6eeae10f9e90445dffb839bbf5464bb9303a29f3ea5e63d8349c57c7bfd86ae9 |
| browser-http-authority-full-build-20261031 | Working-checkout build passed | 233eab95ce7c2ed25bf1c2c2449512845d01f36be7ea61816e5a020b8785599f |
| browser-http-authority-full-runtime-20261031 | Working-checkout runtime passed | 22d7dbc4bb1eaf4a5e15dda69f7aea93f83c92d977b97c3bab5182bbbc6d1209 |
| browser-http-authority-clean-build-20261031 | Exact-commit build passed | 67c7fe526598337290ab95f51dd9695d1e75cd93597cd7aef24d6a17c9193378 |
| browser-http-authority-clean-runtime-20261031 | Exact-commit runtime passed | 874b9a57e40186cbf2fa138c0f8425c0f360d788d7f7ff7b6122dc98d90ca33c |
| browser-http-authority-clean-perf-load-20261031 | Exact-commit performance/load passed | 8a5f2427e71f86e64d9777fecc996cfd5a139d8cc341d1dc730383c397063cb1 |

Independent review: isolated Agon Codex, no blocking introduced defect.
Packet `browser-http-authority-review-input.txt` SHA-256:
`b56190410ffe530a2e8a5a440c70e02dea97066d2bfcbbc0e2dc78e5a049053c`.
Output `browser-http-authority-codex-review.log` SHA-256:
`c4ecfa07be005bcd7efcb00581bf451b104d16dbaab1c8e1682f0ced32fb726f`.
The complete committed runtime bytes match the reviewed packet. Runtime SHA-256:
`d84a11c81493796a5ad489cece1e79fb30fa0edf8845afea2a21647baf41b8ab`.
Review-requested natural-completion and ledger assertions were added afterward
and checked locally. Adjudication is archived as
`browser-http-authority-review-adjudication-20261031.md`.

## Remaining limits

This qualifies the bounded admission repair, not the whole modular release.
Atomic admission against another process and durable retention of active Browser
generations remain separate acceptance work. No live extension/provider test,
other native platform evidence, global installation or promotion is claimed.
Merged-main reconciliation and original full modular acceptance remain open.
