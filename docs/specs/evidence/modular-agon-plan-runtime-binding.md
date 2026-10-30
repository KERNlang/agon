# Plan activation runtime: evidence index

Runtime subject: `499992725fd740e0f3b9affba520220249f7d77e`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Date: 2026-10-30. Platform: macOS arm64, Node 26.12.1, npm 11.20.0.
Status: working-tree gates and exact committed clean-checkout qualification pass.

## Scope

Plan activation owns one execution/estimation runtime. The selected CLI host
shares its history between proposal, approval, execution and advisory routing.
There is no Core fallback. Disabled, unselected and disposed runtimes cannot
start a backend. Work already dispatched can drain and retain its checkpoint.
The existing scheduler, cost policy and persisted plan formats remain in use.

Core public compatibility exports remain. This is not complete A20 retirement
or full modular release acceptance. No dependency was added. The migration
ledger differs in 50 hash leaves only, not ownership assignments.

## Reproduce

Use a clean detached checkout of the runtime subject, an isolated home/cache,
and provider blockers. Install locked dependencies with scripts disabled:
`npm ci --offline --ignore-scripts --no-audit --no-fund --cache <prepared-cache>`.
Run `npm run build`, `npm run typecheck`, `npm run lint`,
`npm run guard:reexports`, and `npm test`.
Check the ledger with
`node scripts/spec/generate-modular-first-party-migration-ledger.mjs --check`.
Run `node scripts/spec/verify-modular-npx.mjs --no-write` with
`AGON_S9_NPM_CACHE=<prepared-cache>`. Do not regenerate metadata in the clean
qualification checkout. Check its commit and clean status before and after.

## Durable receipts

Raw files remain outside shipping packages in
`/Users/ra/dev/modular-agon-remediation`. Each run below has `.receipt.json`
and `.log` files named by its ID. Receipts retain commands, exit status,
duration, provider-launch records and log SHA-256. Failed runs are retained.
This index does not make machine-local raw files available to other machines;
the tests and verifier needed to reproduce the checks are tracked.

All run IDs below start with `plan-runtime-binding-` and end with `-20261030`.

| Run suffix | Result | Log SHA-256 |
| --- | --- | --- |
| baseline-cache | Full baseline: 12,112 passed, 7 skipped | `ca8a577dbcd9e61b464923f5372145049977dc5d9c4ea68fd278701ddbed88da` |
| red | Missing activation binding fails two tests | `9ff9677a0261d27780b04ec976789715f5b60d03609ec530f88d48ddee4648d0` |
| stale-red-valid | Captured runtime wrongly executes after pointer change | `d054960f4a276ec3d232bcaa6554f3f50c30d0e832deb2cadab22e3cffbe91da` |
| revocation-red | Three backend-after-revocation cases fail | `512cfede22ff0f5f90383a5ca257de29bec9d509dc9be43cdbd4ac4867c306d8` |
| revocation-fixed | 32 tests and typecheck pass | `e9ee9ea662e09ec853e0d079888bb63698c4f3aea2b77bb1d38c257960533cdc` |
| generation-failure | Actual registration-commit and later-owner failures revoke binding | `e13a5f6cf414a62133d401ea4ba638bb9505dd9516a7189b852f43ff509010f0` |
| history-mutant | Removing history recording makes cross-consumer test fail | `eb53e58559e6492a8861186fbe54cf71f85c7dc08d03d02280c77ffee06e7583` |
| history-restored | Restored source: 20 tests pass | `693f348bc64e6de9630dddfdca0ebbf3d39dd310e2b9d11a24dbb6e4ae209b5f` |
| full-fixed | Three Cesar fixtures fail without activated host | `0b7b8d3724af1797580b560bb51cbccaaca3422c1d01556bc731b75e9ab965ca` |
| cesar-host | Real host fixture setup: 112 tests and typecheck pass | `b9716f973c501b84c46f7b145b9a93e37e4e3485893e0c7132b2b4e5431f967c` |
| installed | Packed runtime lifetime/history/draining and public-type checks pass | `8b313d5ea13adc9f304353065291d26e777d743674ab5bfba279b351f2932ae3` |
| full-final | Build/types/lint/guard/release/SBOM pass; 12,125 tests pass, 7 skip | `175df10555e14ea9f1741b2c9d26802a6e853266fc9c4a8948cb2c447dad686d` |
| clean-build | Exact committed checkout: offline install/build/types/lint/guard/ledger pass | `fd4f6118d76f070c6db2b1bf3a2ff58f13c49073009053c95c873c9fda81004f` |
| clean-runtime | Release/SBOM self-tests, 12,125 tests, installed probes and clean status pass; 7 tests skipped | `54b2eff68fb335eb7d2fbfdb9dc490b7a5d171224f4ed69261bb1b21c67eb183` |

Every listed runtime receipt records zero provider launches. These are isolated
fixture workflows, not live-provider or cross-platform acceptance evidence.
The clean build kept Git clean before and after. The existing contamination
scanner found no source-bearing ignored, untracked or unstaged files, with no
additional exclusions. It verified 36 S5 packages and 348 S5 assignments; those
counts are not a claim that the full modular ownership roadmap is complete.

## Independent review and adjudication

One isolated Agon Codex review completed with exit 0. It reviewed a source
packet and did not execute tests. Archive files:
`plan-runtime-binding-review-input.txt`,
`plan-runtime-binding-codex-review.log`, and its `.receipt.json`.
Packet SHA-256: `8e129cbf01536facab8341a2291f1b2e896bedbb0fea1ba075340b3560973476`.
Review log SHA-256: `bbd4088c7e06f3b5aa433260245ee67943296c48821f1e0952d5309ef67ae745`.

Confirmed P1: checking authority only at executePlan entry allowed a pending
scheduler to dispatch later backends after revocation. Three controlled-promise
tests failed before the fix. The bound runtime now checks each backend entry.
Existing draining and checkpoint behavior remain owned by the scheduler.
Coverage requests for generation failure and real cross-consumer history were
also addressed. CLI execution learns 20 tokens/$0.2 for later proposal/routing;
deliberately different Core history remains 999 tokens/$99. The history mutant
fails with defaults instead of learned values, then passes after restoration.

The packet predates these fixes; the review is not represented as a fresh
review of the final commit. Source-verified adjudication, fail-first tests and
local verification provide the post-review evidence. No second panel was run.

## Remaining limits

Clean runtime qualification took 817.275 seconds. No native
Linux/macOS x64, other Node versions, live providers or publishing are qualified
by this slice. Active/global Agon and personal state were not modified.
Separate follow-up: Cesar's proposal catch can still return PLAN_PROPOSED after
a handler exception. That existing failure-reporting defect is recorded in the
durable handoff and is not concealed by the corrected host fixtures.
