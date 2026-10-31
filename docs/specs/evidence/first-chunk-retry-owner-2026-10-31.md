# First-chunk retry policy ownership

Qualified source: `2bdecfee38f1b886db3e89debe7fcdfcbf6bdd28`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.

Engine Runtime owns the unchanged pure retry decision. Core preserves explicit
compatibility exports; session-resume uses the public owner. No dependency,
policy, configuration or state-format change. This newer source has no frozen
ownership-ledger assignment; its owner is an architectural inference, not a
claim that a frozen occurrence was retired.

## Verification

Baseline: 12,112 tests passed, seven skipped. Candidate and exact committed
clean checkout: 12,116 passed, seven skipped. Build, types, lint, re-export
guard, metadata checks, roadmap and release/supply-chain self-tests passed.
Installed qualification passed 129 checks; diagnostics passed 31 tests,
including real tsc. Performance and sustained-load gates passed. Clean Git
and source-bearing ignored/untracked/unstaged contamination checks passed.
All qualification runs recorded zero provider launches.

Negative controls: four ownership tests failed before extraction; removing
the compatibility function export failed two tests; reversing side-effect
refusal failed the frozen-source test even with stale dist. Restored tests
passed. Existing session-loop tests cover safe retry and refusal after effects.
The AST hash proves source preservation, not behavior by itself.

One isolated Agon Codex review found no introduced defect. Nine complete
packet files and two explicit excerpts matched the committed source. The
inherited unvalidated retry counter concern has no found production path:
the caller initializes zero and only increments it. External malformed direct
calls are not claimed safe. Temporary review credentials were removed.

49 packages and 158 dependency edges remain unchanged. Only Engine Runtime's
modular payload changed: one declaration file, 1,291 unpacked bytes. Release
archive metadata was regenerated; it is not claimed byte-identical.

## Durable evidence index

Archive root: `<MODULAR_AGON_EVIDENCE_ARCHIVE>` (operator-managed, outside Git).
All run filenames use prefix `first-chunk-retry-owner-`, followed by the row
suffix and `-20261031.log`; matching `.receipt.json` files contain exact
commands, exit codes and timings. Hashes below are SHA-256 of log bytes.
Keep the archive until Raphael explicitly approves deletion.

| Suffix | Result | Log SHA-256 |
| --- | --- | --- |
| baseline | pass | 2f27562bad0b942eb3e0e44c663c8d3ed47d3905c5c51a7ae25be4df6fecc054 |
| red | expected failure | ee826119185c25c849b1f40db78eaa5b7c83ded7cc0fc39699dcfeb70ecca48a |
| focused | pass | 0f98ff8945289892eaead74b78f8f8491ec86952bd9f23d6456dc6496536c6d6 |
| export-negative | expected failure | 8760ed5263b3e68b658d2053d81d170e2a62a1a4b907d154faaef6c21f4cd789 |
| policy-negative | expected failure | fcc75e93d4dd78de36fe0b87ab0d4c21dc2a5d6be45401b887e7b646413c87ba |
| restored | pass | 052e6012d8b9edd98f147fa9dc19feb663d093aed3380cc020c4978acd8070a2 |
| full-gate | pass | 7bbcb742cc497b05f17b420c43d25a6c262df9c05debaecb4c9da3f04fa28319 |
| clean-build | pass | 8a9c019fceda3f40ad3c17a5e8890c53a85ee1d38d2443f24c2205409aa85b2d |
| clean-runtime | pass | 0fb4f2e0aaaec0a0013b4628f89daabc51bce8ed36ac41927ee63f9ad09d99d1 |
| clean-perf-load | pass | 4f8ab80649df82423b8bbc0c428455ee71892bec475810edcc3cb276fb62e713 |
| clean-contamination | pass | cd69817819a89c9880216d767342dc6f04ee00c57e2397a769c45ba4922121f1 |

Review packet `first-chunk-retry-owner-review-input.txt`:
`6b4a1d897a3c6c818e5d1885ac28bf64448621eb81c7d2a0a0af36fdcdd6c28e`.
Review output `first-chunk-retry-owner-codex-review.log`:
`8924722a9a10d23c5a8220274cfd3533f638696d3f93b50e7722a71d093369de`.
Adjudication: `first-chunk-retry-owner-review-adjudication-20261031.md`.

## Limits

Native evidence is macOS arm64, Node 26.12.1. This is one independently
qualified migration, not full modular release acceptance or an integrated
receipt for pending PRs. Compatibility exports remain intentionally available.
No live-provider, other-platform or publishing qualification is claimed.
No global Agon installation or personal state was changed. Human merge required.
