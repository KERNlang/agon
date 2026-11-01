# Control-plane ledger ownership evidence

Status: component qualified; human merge and aggregate release acceptance pending.
Date: 2026-10-31. Native qualification: macOS arm64, Node 26.12.1.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Tested source: `a856c76048f0e75a605920299328f74804500943`.
The commit containing this index adds evidence only, not tested runtime changes.

## Change and boundaries

Move the byte-identical control-plane ledger implementation from Core sessions
to the existing Persistence package. CLI imports the public owner. The old Core
path keeps explicit value/type compatibility exports. Recovery policy, disk
format, storage paths and event-log instance are unchanged. No dependency added.
Persistence ownership is inferred from the existing event-log owner; this newer
file is not represented as an assignment in the frozen ownership ledger.

This change is independent of pending SessionHost/session-contract PRs.
The Core export adapter remains intentional compatibility, not retired machinery.
No active installation or personal state was modified.

## Verification

One baseline full gate, one candidate full gate, and one exact-clean-checkout
full suite passed. Both candidate suites: 12,117 passed, 7 skipped.
Clean qualification includes build, types, lint, export guard, check-only
release-set/SBOM/roadmap verification, release/supply-chain negative controls,
129 installed checks across 15 packages, cache deletion and idempotence,
31 diagnostics including real TypeScript compilation, performance and sustained
load checks. Source-contamination result: ignored/untracked/unstaged source empty.
All qualification receipts record zero provider launches.

Five new tests failed before extraction. Focused gate: 75 passed. Removing the
legacy recovery export failed; changing the retry predicate failed even with
stale compiled output. Restoring source passed all five ownership tests.
Two real Node processes verify append, restart recovery and sequence continuation.

49 package identities and 158 dependency edges remain unchanged. Package JSON
and manifest hashes, versions and dependencies remain unchanged. 48 modular
payloads remain unchanged. Persistence adds one declaration file (33 to 34
files) and 3,252 unpacked bytes. Tarball metadata was regenerated, not asserted
byte-identical across packages.

## Durable archive and hashes

Archive root: `<local-evidence-archive>/modular-agon-remediation/` outside Git.
Raphael retains this archive; do not delete it without his approval. Each run
below has `.receipt.json` and `.log` files. Receipts contain exact commands,
exit status, elapsed time and provider-launch records. Hashes below are SHA-256
of raw logs. Prefix: `control-plane-ledger-owner-`; suffix: `-20261031`.

| Run | Result | Log SHA-256 |
| --- | --- | --- |
| baseline | pass | `0c151581c3d26126420a81cd98540e09b892dd5a9fd3268d8608cd284779112c` |
| red | expected failure | `9f845844abfeafb96d1f3d7e5436762b6144998e9801a7d8a383a2313b8c2c65` |
| focused | pass | `77e14acb9aed689a388a5511bab79182ca08a7482a9e95926c447093c83bf7bd` |
| export-negative | expected failure | `70cb63d03aa3d91ac7e33085bc6b6592a82bf30009ae3302b2b9193ab0ad0b76` |
| policy-negative | expected failure | `e0e00548252c5637f2866e719c526358a72752ed9c90d31da0f5e1e24118d38f` |
| restored | pass | `3fe89f08f61e75e1da8a99aa3482c2084a2a8edcce59d012dd461127ca609a71` |
| full-gate | pass | `b812f3fe1a501e107df8f7d8631022ab731f15a1b998cecea79c3d1538494d05` |
| clean-build | pass | `54598c490176347b5955c4abbd0c72b922d1abca77f83a371ac75e53083efc27` |
| clean-runtime | pass | `2503281cb7a91b99a63183d5c991d1861463af6881f4ad15a021c02aee24b4f8` |
| clean-perf-load | pass | `d43c432d8ae4ffda504b75aabb128c23acc6cd10d9266c6e944ab50865462ca6` |
| clean-contamination | pass | `0b623b94feaf8816a69fe5aca7003f839bb5fd8f7cd95451480917b87bafe3d0` |

## Independent review

One isolated Agon Codex review; no introduced actionable finding. No OpenCode
or Kimi invocation. All 13 packet files matched committed Git blobs.

- Packet `control-plane-ledger-owner-review-input.txt`:
  `35e07f89b70d69fc5f8e4c95c17aa0741660f4d8141f132a934d32612a06d151`.
- Output `control-plane-ledger-owner-codex-review.log`:
  `62b6c15368e4a847a848b76f88ac198fc89afb3be8f7b61b0ae9fea32f2e487c`.
- Adjudication: `control-plane-ledger-owner-review-adjudication-20261031.md`.

The review correctly cautioned that a compiled test alone does not bind current
source. Rebuild-before-test, source assertions, stale-dist negative control and
exact clean qualification cover that concern together. Inherited correlation
collision/terminal masking concerns remain unproven production hypotheses,
not introduced defects. No policy redesign is claimed here.

## Reproduction and limits

Use an isolated checkout at the tested commit, isolated homes/caches and provider
blockers. Run locked offline installation with scripts/audit disabled, then:

```sh
npm run build && npm run typecheck && npm test && npm run lint && npm run guard:reexports
node scripts/spec/verify-modular-release-set.mjs --check
node scripts/spec/verify-modular-supply-chain.mjs --check
node scripts/spec/verify-modular-agon-roadmap.mjs
npm run test:modular-release && npm run test:modular-supply-chain
node scripts/spec/verify-modular-npx.mjs --no-write
AGON_IT=1 npm_config_offline=true node node_modules/vitest/vitest.mjs run tests/unit/diagnostic-runner.test.ts
npm run perf:modular-release && npm run test:modular-load
```

Offline installed checks require prepared `AGON_QUALIFICATION_NPM_CACHE` and
`AGON_S9_NPM_CACHE`. The receipt archive preserves the exact invocation.
Source-contamination uses `collectSubjectContamination` plus
`isSourceBearingPath` from `scripts/spec/slice1b-qualification-gates.mjs`.

These are component receipts, not nine canonical integrated release receipts.
Pending PR integration, remaining ownership/adapter retirement and final
same-subject acceptance remain open. Native Linux/macOS x64, other required
Node versions, live providers and publication are not qualified by this run.
