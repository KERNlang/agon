# Daemon protocol ownership evidence

Status: this ownership slice passed local clean-checkout qualification. Not full modular release acceptance.

## Subject and scope

Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Source: `87cdabae7adbb6a92b10105f4d22c687364680bb`.

Jobs owns the daemon wire protocol implementation. Core keeps explicit public compatibility exports; CLI consumes Jobs directly. Protocol behavior is unchanged. The existing package generator and declaration inventory now preserve these exports. The generated surface catalog changes only Jobs content identities.

This does not retire the complete daemon host or establish full modular acceptance. Owner selection follows existing Jobs daemon contracts and controllers; it is not evidence that an exact frozen ownership-ledger occurrence has migrated.

## Evidence location

Raw receipts and logs remain in a durable operator archive outside Git. `<archive>` denotes that archive; it is not a shipping directory. Keep failed runs and negative controls. Do not delete the archive without Raphael's approval.

Each run below has `<archive>/<run>.receipt.json` and `<archive>/<run>.log`. Receipts record commands, exit codes, timing, log hashes and provider launches. All 19 terminal runtime log hashes were independently recomputed and matched, as did the separate review input and output hashes. All runtime receipts recorded zero provider launches.

| Run prefix `daemon-protocol-owner-` | Result | Log SHA-256 |
| --- | --- | --- |
| `baseline-20261031` | Pass before migration | `efdc03c94ef0a0cb763b387701e768b1e285c7191ab976ee08f839e0af99fd25` |
| `red-20261031` | Expected failure: four ownership checks | `f70f0a72436fbcc8b136de6fd4580deb54b54b5bbbc7ed4dcbf20057376c2765` |
| `export-negative-20261031` | Expected failure: missing public export | `dd833b80f3ea74b8a12966a2e83b303d67a019286f7ca9f34a3a9505e241ec57` |
| `framing-negative-20261031` | Expected failure: discarded frame remainder | `091bee8632a70c143cc8ea5a2709bbc97d9a7758c6080ef1dd476592511d8c40` |
| `authority-negative-20261031` | Expected failure: removed request admission | `34cd5c0bebe36a7179f6acc41437d5359358e98d3a86d62db230768e7605b27a` |
| `full-20261031` | Failed: generator erased exports; repaired | `94af9bbd925a506f2d0df296fa09de58386fd2daba8e699d27333682efe451e0` |
| `final-full-20261031` | Failed: stale catalog identity; repaired | `02c78b83edf7aab0f1f8b075be0a6c0a0365e7b352fd245cbd0addf386c0befe` |
| `packaged-20261031` | Pass: 132 installed checks | `94a7966e39c5ba117f6d9f890747d0eb9aa53e2fd80baa013d17958fe5e6a16c` |
| `final-tests-20261031` | Pass: 12,116 tests, seven skips; types/lint/export guard | `687b99c982af7dc3b6c45f214e63b1f274a73f0d1362bdfc3e749ff7b32a657a` |
| `clean-build-20261031` | Pass: exact commit, offline install, build/types/lint/export guard, clean before/after | `6840ba734e8578a55bf78e18f869e24864b62e18e25ee00b53831157d40a072c` |
| `clean-runtime-20261031` | Pass: release/SBOM/roadmap, 12,116 tests with seven skips, 132 installed checks, 31 diagnostics, clean before/after | `b6f167c64e3b238d628698020c97eed56d8a477052d58e88911b0892bff925a2` |
| `clean-load-20261031` | Pass: eight slice performance gates and sustained load | `f58ebeb512ef529c0e00f2ceb3dc57515713f70dd14cd88df6fcfe05ec8d5bea` |
| `clean-contamination-20261031` | Pass: pinned clean subject, no ignored/untracked/unstaged source | `0465f1b7d6c24d768003f26ea0542c098838948c96afaf811685e1d911f5fb7c` |

Restored controls passed; no negative mutation remains in the subject. Neither failed full run qualifies the candidate. Clean committed runtime and diagnostics passed in 805.672 seconds, with zero provider launches. Performance/load passed in 278.629 seconds: 712 verified workflow outputs, peak concurrency four, zero pending fixtures, failure/cancellation/recovery/shutdown controls green. Workflow request p95 was 8.39 ms; peak daemon RSS was 182,140,928 bytes. Final contamination qualification passed.

## Independent review and resolution

Isolated Agon Codex review completed. Input: `daemon-protocol-owner-review-input.txt`, SHA-256 `c081762e966b00c933cacce45d06c6bab7d5a033f09585101f5cfbc7ce0407d2`. Output: `daemon-protocol-owner-codex-review.log`, SHA-256 `c0ea13232cabe4a109d416222cd3e526b987ae9f3d35b4fb7fbf1e549cafd800`.

Two confirmed verification gaps were closed: installed public runtime/type consumers, and all six fresh Jobs requests after authority revocation. Existing installed verification and socket tests now cover these paths. Removing admission fails three revocation scenarios. Missing exports and broken framing also fail meaningful controls.

The reviewer did not identify an introduced production defect. It missed generator drift, later caught by full tests. Generator, manifest, catalog and installed-verifier additions were checked locally, not included in the earlier model packet. Core compatibility checks use the compiled Core root; Core is not an independently packed release artifact. Jobs checks use the packed Jobs owner. These evidence classes must not be conflated.

## Reproduction and limits

Use a disposable checkout at the source commit, isolated home/cache/prefix and provider-denying shims. Run frozen install with scripts and audit disabled, then repository build, types, lint, export guard and full tests. Run generated-package verification and its self-test, release-set and supply-chain verification, installed npx verification, and daemon diagnostics. Exact commands are retained in each receipt.

After the isolated frozen install and build, the clean runtime gate executed:

```sh
node scripts/spec/verify-modular-release-set.mjs --check &&
node scripts/spec/verify-modular-supply-chain.mjs --check &&
node scripts/spec/verify-modular-agon-roadmap.mjs &&
npm run test:modular-release && npm run test:modular-supply-chain &&
npm test && node scripts/spec/verify-modular-npx.mjs --no-write &&
AGON_IT=1 npm_config_offline=true node node_modules/vitest/vitest.mjs run tests/unit/diagnostic-runner.test.ts &&
git diff --exit-code && test -z "$(git status --porcelain)"
```

The runner pins HEAD before executing these commands, supplies isolated caches and provider blockers, and records the exact environment-independent command. Do not run these instructions against personal state.

Performance/load reproduction: `npm run perf:modular-release && npm run test:modular-load`, with the same pinned clean subject and isolated runner. Final contamination uses the existing `collectSubjectContamination` and `isSourceBearingPath` gates over the whole checkout, plus exact HEAD and clean Git assertions.

Remaining release requirements include integrated owner retirement and nine ordered canonical acceptance receipts. No live-provider, other-platform, publishing or full release-readiness claim is made. Active/global Agon and personal state remain outside the test target.
