# Companion timeout classification qualification

Status: this fix passed local qualification. Not full Modular Agon acceptance.
Base:26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7.
Branch:fix/modular-companion-rpc-timeout.
Committed subject:70f9537300a4dbb92af63db283d003b7c7cbec32.

## Behavior

RPC timer expiry produced `Timeout waiting for ...`, while the result classifier
looked only for `timed out`. The actual deadline therefore returned exit2 with
timedOut=false. Conversely, an ordinary remote error containing `timed out`
returned exit124 with timedOut=true. Real Node ACP fixtures reproduced both.

The private CompanionTimeoutError now marks both local deadline sites. The catch
uses its identity, not remote wording. Error text, public contracts, partial
output and finally cleanup remain unchanged. No dependency or new helper file.

Five new real-process cases exercise ACP stall/success/error and stream-json
stall/error. They preserve partial output and check direct-child termination.
Classifier-only reversion fails ACP expiry and both remote errors; stream-json
expiry and ACP success remain passing controls. The fixed classifier is restored.

## Durable runtime receipts

Raw logs and receipt JSON remain in the operator archive outside shipping Git.
All eleven runtime log hashes were independently recomputed; zero provider launches.
Expected failures remain archived and are not reported as green runs.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| companion-rpc-timeout-baseline-20261031 |54tests,2.834s,exit0 |32c361e9a44766e83db35e2f778cd3ec696f57287ff3e987eccf8d6968472aa5 |
| companion-rpc-timeout-red-20261031 |2expected failures/1control pass,1.84s |2922cc70ab4f826ecc265e1a825b6facd2eba418ebd8751930d01e30684a0cf4 |
| companion-rpc-timeout-green-20261031 |57tests/types/lint/guard,63.063s |4960502112824356d8574c2e66d6d64ce46a4e95864f756fd4a7fd7cb089ceb5 |
| companion-rpc-timeout-paths-20261031 |59tests,5.484s |f55ccf6ecf5952475aceded91e960909b72eec40b61776ab3bd4481eae1572c0 |
| companion-rpc-timeout-negative-20261031 |3expected failures/2controls pass,3.068s |fcff6117ba9679266b3ff25548db196449eb19dd204eec982c5a0fd0767781e8 |
| companion-rpc-timeout-restored-20261031 |59tests,5.314s |0a3cc0b5d512ac7bbe019161d4010715aa2f6b838365ebdeb9f8326a20cc8992 |
| companion-rpc-timeout-full-20261031 |12117tests/7skips,873.832s |3bea6efdcdb78df190ba9f7e5900bd543c469fba45308d59ba570dc13f4a07aa |
| companion-rpc-timeout-clean-build-20261031 |offline install/build/types/lint/guard,226.243s |5c9aeabdeba93e7003fe22399c4021582af6b21034478ffcbe029aa35bf0b3a2 |
| companion-rpc-timeout-clean-runtime-20261031 |12117tests/7skips,129installed checks,31diagnostics,778.799s |ff65fee0ec9d38e022c7fd421b27b67011479624f5265cd886fb6b9ec2ff68ca |

| companion-rpc-timeout-clean-load-20261031 |performance/load,278.304s |6913004271e81e503bc11a6e4f617f721fbbeef113be88cbff031760a544f7df |
| companion-rpc-timeout-clean-contamination-20261031 |clean source,0.237s |0465f1b7d6c24d768003f26ea0542c098838948c96afaf811685e1d911f5fb7c |

## Independent review

Isolated Agon Codex: no introduced defect. Packet SHA256
0e4bac78af146d7f3f7c6c16f4f2ce0d2cc9493eb07d6654a106de2e671904b5;
output SHA25609c72a5fdf0832e606317bf38758f5e3ee9de6e343442a2a229f25f3a650d83f.
Both hashes verified; complete source/test packet bytes match current files.
See companion-rpc-timeout-review-adjudication.md for source checks and limits.
Temporary reviewer auth copy is absent. No reviewer remains active.

## Qualification and limits

Full gate81231 passed873.832s:12117tests/7skips,all repository gates,zero providers.
Log SHA2563bea6efdcdb78df190ba9f7e5900bd543c469fba45308d59ba570dc13f4a07aa.
Clean build74973 and clean runtime84862 passed on the pinned committed subject.
Performance/load94114 passed278.304s. Workflow phase verified712outputs with
concurrency4,pending0; failure/cancellation/recovery/shutdown controls passed.
Contamination check passed: ignored/untracked/unstaged source lists empty.
Installed checks survived cache deletion and proved idempotence.
Evidence is native darwin-arm64 only; no other native platform is qualified here.
No direct new initialization-expiry, JSONRPC-specific, abort-race or descendant
cleanup tests. ACP covers shared send() expiry; stream-json covers turn expiry.
Per-request budgets and completion-before-deadline ordering are unchanged.
Direct adapter fallback integration is source-traced only. Empty-output fallback
is not fixed here. Integration with unmerged ownership PR386 and stderr PR387
must preserve all changes at the eventual owner; this branch does not depend on them.
Full modular release acceptance and external platform/provider gates stay open.

## Reproduction

Use the pinned subject in a separate clean checkout. Run frozen install with
scripts disabled, then `npm run build`, `npm run typecheck`, `npm test`,
`npm run lint`, `npm run guard:reexports`, `npm run test:modular-release`,
`npm run test:modular-supply-chain`, `node scripts/spec/verify-modular-npx.mjs --no-write`,
`AGON_IT=1 node node_modules/vitest/vitest.mjs run tests/unit/diagnostic-runner.test.ts`,
`npm run perf:modular-release`, and `npm run test:modular-load`.
Use isolated homes/caches and provider blockers. Exact commands, durations and
log hashes are preserved in each named receipt under the durable operator archive
`/Users/ra/dev/modular-agon-remediation/`. Raw logs are outside shipping packages.
Generated release-set, SBOM and release-channel changes bind the source change;
they are not additional implementation. Human merge remains required.
