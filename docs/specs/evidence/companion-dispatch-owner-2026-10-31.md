# Companion dispatch ownership evidence

Status: this ownership slice passed local clean committed qualification.
This is not full modular release acceptance.

## Subject and scope

Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Source: `36a1215f7ae1f66c50d8493901fd3cac503b20f9`.

Engine Runtime owns the companion subprocess transport. The implementation is
unchanged except for its type import. Core keeps explicit compatibility exports;
Adapter CLI retains its public Core import. No dependency was added. The frozen
roadmap assigns the CompanionResult source occurrence to Engine Runtime.

Direct `git show` comparison of the base Core blob and committed owner blob
confirms byte equality after removing only the DispatchResult/CompanionConfig
type-import statement. Normalized SHA-256:
`4e513e850aede75788d4d41e6e0299a07cca92aac96db24ffe802855a0836145`.
This check reads committed Git objects, not ambient worktree bytes.

The support migration ledger is regenerated from its generator. Regeneration
also exposes inherited drift: two Browser Bridge type occurrences become
consumers, and an obsolete Engine Runtime type occurrence disappears. Those
changes are not claimed as ownership work performed by this slice.

## Archived verification

Raw logs, receipts, review input and adjudication remain in the durable operator
archive outside Git. `<archive>` means that archive, not a shipping directory.
Retain failed runs. Do not delete archived evidence without Raphael's approval.
Each run has `<archive>/<run>.receipt.json` and `<archive>/<run>.log`.

| Run prefix `companion-dispatch-owner-` | Result | Log SHA-256 |
| --- | --- | --- |
| `baseline-20261031` | Pass before migration: 12,112 tests, seven skips, full gate | `b945406edc1653170a452abd50a87c3961a3f86876a983b65b6b28cb7f58b59d` |
| `red-20261031` | Expected failure: three missing-ownership checks | `4da7094b2515424571d59fe19845656101c11fa7426a7732cea52636655f1b78` |
| `first-green-20261031` | Pass: owner build, types and focused checks | `99cb5cd2a5b76fd8d77081a50ae6171a9f50e22d6f6161a685a3889e0910a47e` |
| `wire-20261031` | Pass: 59 focused tests, types and ledger check | `08345ca0609c270291f103be794c66b30b787e59dc72208f83c0af309cf01f7a` |
| `review-negative-20261031` | Expected failure: prompt review incorrectly selects native review | `606bdf1cf583075987697ca82c198d127d67eff7b4bd4aecaf370ca14c946efa` |
| `restored-20261031` | Pass after restoring predicate: 59 tests and hygiene gates | `0e958dff7e9e6b3341eefa89bd31301939c87adfc4332472d710f7eb026223ae` |
| `packed-20261031` | Failed invocation: higher-priority isolated cache was empty | `7a37b65b917cc8189c54e48d2c230d1063208521394df563302b654437ed2af1` |
| `packed-cache-20261031` | Pass: release/SBOM, 132 installed checks, 59 focused tests | `89aaf1b0ed737a5085f88d471fe95b2095e3ba1a2329876f9720568ca3abd522` |
| `export-negative-20261031` | Expected failure: missing Core export fails two checks | `8ad794a52541edbb34d71b65c5a3e41b0f366a19386f2f2e3eb799f1002da393` |
| `full-20261031` | Pass: 12,117 tests, seven skips; build/types/lint/export guard/ledger/release/SBOM | `cf23c6226f4d2edb7a2f5ab590067ea04a1d21ae1e4c82c1074e257c28ff71dd` |
| `clean-build-20261031` | Pass: exact commit, frozen offline install, build/types/lint/export guard, clean Git before/after | `f9dafb422f0dd25225090af199cb7a3982240d1689bef6bcfd00bb1c7df357f7` |
| `clean-runtime-20261031` | Pass: release/SBOM/roadmap, 12,117 tests with seven skips, installed checks, 31 diagnostics, clean Git before/after | `bd9e5992cebd777e38ffbb71a0c13b2a4041fb5ba48e9cfbf16bc0bea77dc8af` |
| `clean-load-20261031` | Pass: eight slice performance gates and sustained workflow load | `d073feb2a6d3bfdb30d78dedfada5d3d25a66ac39d186c2870644027cab2eef2` |
| `clean-contamination-20261031` | Pass: pinned clean subject, no ignored/untracked/unstaged source | `0465f1b7d6c24d768003f26ea0542c098838948c96afaf811685e1d911f5fb7c` |

Both negative mutations were restored. The three ownership checks passed again
before the full gate. All listed runtime receipts record zero provider launches.
The packed fixture exercises the actual installed Engine Runtime package.
Core verification uses its compiled repository root, not an installed Core
package. Core is not a standalone artifact in the current release set.

## Independent review

Isolated Agon Codex review completed with no introduced transport defect found.
Input: `companion-dispatch-owner-review-input.txt`, SHA-256
`12b162bb85b1ebc931bb497c3c3701b1bcc1bb13e7fe4d90227d4fe259b70627`.
Output: `companion-dispatch-owner-codex-review.log`, SHA-256
`0d1a4ce3e091abadca9e845a86b379fcc10b0dada4fd53cd63a23613fd9f3ec3`.

Confirmed coverage gaps were closed after review: the public type consumer now
checks DispatchResult's required fields and the owner's JsonRpcMessage, and the
existing predicate test covers agent mode with an explicit review target.
These additions passed locally; no second model review is claimed.
Core root exports were checked against source. The installed-Core recommendation
is not represented as completed: that package is outside this release set.

The review also identified inherited transport concerns: stderr is not drained,
RPC timeout wording differs from the timeout classifier, and the pre-aborted
return bypasses the main finally block. They match the original source. They
remain separate reproduction/fix candidates, not silently included in this move.

## Reproduction and remaining gates

Use a disposable checkout at the source commit with isolated home, cache, prefix
and provider-denying shims. The recorded runner commands use frozen offline npm
installs with scripts and audit disabled. Do not run against personal state.

Exact clean checkout build and full runtime qualification passed, including
installed checks and 31 diagnostics, with clean Git before and after each gate.
Performance/load passed: 712 verified workflow outputs, peak fixture concurrency
four, zero pending fixtures. Request p95 was 8.27 ms; peak daemon RSS was
180,879,360 bytes. Failure, cancellation, recovery and shutdown controls passed.
Contamination verification found no source-bearing ignored, untracked or unstaged
files in the qualified checkout. All 14 runtime receipt/log hashes were rechecked.

Reproduction after isolated frozen install and build:

```sh
node scripts/spec/verify-modular-release-set.mjs --check &&
node scripts/spec/verify-modular-supply-chain.mjs --check &&
node scripts/spec/verify-modular-agon-roadmap.mjs &&
npm run test:modular-release && npm run test:modular-supply-chain &&
npm test && node scripts/spec/verify-modular-npx.mjs --no-write &&
AGON_IT=1 npm_config_offline=true node node_modules/vitest/vitest.mjs run tests/unit/diagnostic-runner.test.ts &&
git diff --exit-code && test -z "$(git status --porcelain)"
```

Then run `npm run perf:modular-release && npm run test:modular-load` and the
existing `collectSubjectContamination`/`isSourceBearingPath` gates. Each archived
receipt records the exact command, pins the source commit and asserts clean Git.
The frozen cache is supplied through both AGON_QUALIFICATION_NPM_CACHE and
AGON_S9_NPM_CACHE. Measurements are native macOS arm64 with Node 26.12.1;
the repository test launcher selects its supported test runtime separately.

Full modular acceptance still requires integrated ownership and adapter retirement,
canonical acceptance receipts and separately recorded external platform/provider/
publishing evidence. This slice does not certify those requirements.
