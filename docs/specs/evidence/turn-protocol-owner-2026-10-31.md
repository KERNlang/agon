# Turn protocol ownership

Source subject: `b191caf95f5a1b3deb5c54fc3affdc55dde05f1b`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Status: this slice qualified locally; full release acceptance remains separate.

Engine Runtime owns the unchanged pure control-plane envelope validation,
producer/response fencing and turn lifecycle reducer. Core preserves six
explicit function exports and four type exports. CLI turn-runtime imports the
public owner. No dependency, policy, configuration or state-format change.
This newer source has no frozen ownership-ledger assignment; placement is an
architectural inference, not a retired frozen occurrence.

## Verification

Baseline: 12,112 tests passed, seven skipped. Candidate and exact committed
clean checkout: 12,116 passed, seven skipped. Build, types, lint, re-export
guard, release/SBOM checks, roadmap and release/supply-chain self-tests passed.
Installed qualification passed 129 checks; diagnostics passed 31 tests,
including real tsc. Clean install used the frozen lockfile and offline cache,
with lifecycle scripts and audit disabled. Git remained clean.
Performance and sustained/concurrent load gates passed. Concurrent load completed
704 fixture jobs with 704 verified outputs, peak concurrency four and no pending
fixtures. Failure, cancellation, recovery, shutdown and host-file cleanup controls
passed. Clean-subject source-bearing contamination checks passed. All qualification
runs recorded zero provider launches.

Four ownership tests failed before extraction. Removing a Core export failed
the compatibility checks. Rebuilt response-fencing mutation failed byte
preservation and two duplicated latest-response runtime cases: one distinct
behavioral scenario, not two independent dimensions. Restored tests passed.
Existing tests exercise superseded-producer fencing, latest-response authority,
legacy sequence-less compatibility and real adapter envelope decoration.
Frozen bytes alone are not runtime proof.

One isolated Agon Codex review found no introduced defect. All 13 full packet
files and the explicit runtime-test excerpt match committed Git objects,
excluding packet separator whitespace. Temporary review credentials were removed.
The review's old-checkout links resolve by relative source path; adjudication
records the correction. No second review or OpenCode call was made.

49 packages and 158 dependency edges remain unchanged. Versions, dependency
sets and manifest/package metadata hashes are unchanged. Only Engine Runtime's
modular payload changes: one declaration file, 5,679 unpacked bytes. Archive
metadata was regenerated and is not claimed byte-identical.

## Durable evidence index

Archive root: `<MODULAR_AGON_EVIDENCE_ARCHIVE>` (operator-managed, outside Git).
Run filenames use `turn-protocol-owner-`, the row suffix, then
`-20261031.log`. Matching `.receipt.json` files contain exact commands, exit
codes and timings. Hashes below are SHA-256 of log bytes. Keep the archive
until Raphael explicitly approves deletion.

| Suffix | Result | Log SHA-256 |
| --- | --- | --- |
| baseline | pass | 28eb0096cf5c82cf6f46ab7a8fc533127f4b1dca5a2a25df407d428f5878bc2f |
| red | expected failure | 79f0d0144d260befdd6bc0da1ad3261d9a2ff67a170e37bd91430e1fa5231018 |
| public-build | pass | b04a5f16668ee0b066b83d52b82bb014aff55848139ed370a1b805c7aee39420 |
| focused | pass | 41976b17cba470fa17af7c94ba126960e13177d503b997f1cedf36ad0d50f286 |
| export-negative | expected failure | a6fe1682ec7ab358391fece193818f59e68a399f15d1a78bbc1047ef78548ac9 |
| fencing-negative | expected failure | 1d43a5b40f2d93f897222f0a58acf83750a7169ef450bdaa978345dd32562f42 |
| restored | pass | cc92c0c467eb779c194e0ad27aa6301bee8d6534c048cbcf4e2593e7dc351e0c |
| full-gate | pass | c83d5cf87e396a11a55c7c763dc6c4144682107ef1601f4978362ebcf0d1ddfd |
| clean-build | pass | 64a66ec19a657a958ffb19e4e23215e3c72218174501f63ad1f8875dabf3341d |
| clean-runtime | pass | 6d7ba2e44e70b5da3674e812b18d9e429374925be0a2b3cba7c978018d97e2a8 |
| clean-perf-load | pass | 23cfce8247d9e1c292512f9c01e157f41691325bfba48ae57f56379b537f313f |
| clean-contamination | pass | bf4654606ae6d6ec97bcc9ef3c842191dde5e6b9e1b27a04e794b6d8b0ec71b6 |

Review packet `turn-protocol-owner-review-input.txt`:
`5d1924a9ffd5da6f14faa7872783b0d87b8475459ff44519eff03933b14d1d6a`.
Review output `turn-protocol-owner-codex-review.log`:
`4f566d2aae1843b3d68699d55b76211854e844c3e96b8c0f072366db11880894`.
Adjudication: `turn-protocol-owner-review-adjudication-20261031.md`.

## Limits

Local evidence: macOS arm64, Node 26.12.1. This is one migration, not full
modular release acceptance or combined qualification of pending PRs.
Core compatibility exports and unrelated private imports remain; pending
ledger/session migrations are not dependencies of this PR. No live-provider,
other-platform or publishing qualification is claimed. Global Agon and personal
state were not qualification targets. Human merge remains required.
