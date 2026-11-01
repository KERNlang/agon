# Session Budget ownership qualification

Source subject: `62904c1b3acdfb5a33e9eb1adff807b2072f00ea`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Scope: two pure policies move from Core to Engine Runtime; Core keeps explicit
compatibility exports; Cesar imports the public owner. No dependency changes.
Ownership is an architectural inference from the existing SessionBudget owner,
not a claim that the frozen ownership ledger named these later files.

## Results

- Both implementations match base bytes except their SessionBudget type import.
- Six ownership tests fail before migration; 206 focused tests pass afterward.
- Missing legacy constant and changed warning threshold controls fail even with
  stale built output. Both mutations restored; restored ownership tests pass.
- Full gate and exact clean checkout each pass 12,118 tests, seven skipped.
- Clean offline locked install, build, typecheck, lint and export guard pass.
- Release-set/SBOM check-only, roadmap and release/supply-chain self-tests pass.
- Installed candidate: 129 checks, 15 packages; cache deletion survives; setup
  remains idempotent. Diagnostics: 31 passed, including real tsc negative case.
- Performance and sustained load pass on native macOS arm64, Node26.12.1.
  712 completed jobs and verified outputs, zero pending fixtures, p95 request
  8.407292ms, peak daemon RSS182321152 bytes, settled growth966656 bytes,
  shutdown33.883875ms. Failure, cancellation, recovery and cleanup controls pass.
- Exact subject remains clean with no source-bearing ignored/untracked files.
- Qualification runs record zero provider launches. Separate isolated Codex
  review found no introduced defect; all12 supplied files match committed bytes.
- All49 package dependency lists and manifest hashes remain unchanged. Only
  Engine Runtime modular payload changes: two added declaration files and bundled
  policy code, +10272 unpacked bytes. Other48 payload hashes remain unchanged.

## Durable evidence

Operator archive: `/Users/ra/dev/modular-agon-remediation/`, outside Git worktrees.
Never delete without Raphael's approval. Each run below has `.receipt.json` with
its exact command, exit code, duration and provider record, plus `.log`. IDs use
prefix `session-budget-owner-` and suffix `-20261031`. Hashes are log SHA-256.
All11 hashes were recomputed from retained bytes before this index was written.

| Run | Result | SHA-256 |
| --- | --- | --- |
| baseline | pass | b08e4ff7950506bf6b82a38cc166d2cee4954eac6f08b9765742b76ff31fe356 |
| red | expected fail, six tests | 69054632e32ae958e7bd5e4fc2b518abd39d515d4a8ea4063ba5a1fcad80f9e9 |
| focused | pass | ead7b6a99b69497a1ed38abae051e80ccfdfa6152d7c577664be45e044ce7472 |
| export-negative | expected fail | 6c719c6f8fbbd20637d4c54dd2eec91bd7b6bfda552d9b2ded9825df428e311e |
| policy-negative | expected fail | a682c67ba4d63cbf6b7aeb02f71c0d5a904c8f982a1eb776e14cc111c19b7171 |
| restored | pass | 0d457b31f0672c860fecc5c1c5ebed0fd54aaccf9828bccdf5d2751d7a05774f |
| full-gate | pass | 0598ab87b6609e99e607815a4dc7f0377fed15015595d078ae64ddd1b744d0a0 |
| clean-build | pass | 7c2c8fbe2919a9f3ba5b8ebca454afadb4d4939673bda225e47f6f04a041c7e5 |
| clean-runtime | pass | 66df97a6274806e06f910b955784a00f5e02ec8b6d2dd5bd203dddd1e718f7b2 |
| clean-perf-load | pass | 05ef3623f0d4b6c95a1f2f97bb243b39f5ccb297c77d76c2129b59faebb90a3d |
| clean-contamination | pass | 69bc44f6048371dbc1ee4f55fe603c813e32ee01e8b3ab3afabfa0e0c57a8d87 |

Review packet: `session-budget-owner-review-input.txt`, SHA-256
`a9a26a9acf86c3bad9db0295aad86ba6ca02445e50eac14bbe8c31347781585f`.
Review output: `session-budget-owner-codex-review.log`, SHA-256
`4a0246f9eafca791812266b1074c057c7ffce0c243f00c459100abfbaba23f9e`.
Adjudication: `session-budget-owner-review-adjudication-20261031.md`.
Temporary review auth copy removed. Reviewer used supplied source only.

## Reproduce and limits

Check out the source subject into an isolated directory. Use locked install with
scripts disabled; run build, typecheck, test, lint and guard:reexports. Then run
test:modular-release, test:modular-supply-chain, perf:modular-release and
test:modular-load; run verify-modular-npx.mjs --no-write with a prepared offline
cache. Receipt commands provide exact operator paths; adapt only those paths.

This qualifies this ownership migration, not full modular release acceptance.
Core compatibility paths deliberately remain. Unmerged work is not assumed.
Native Linux/macOS x64, other Node versions, live providers and publishing are
not established here. No global installation, main mutation or automatic merge.
