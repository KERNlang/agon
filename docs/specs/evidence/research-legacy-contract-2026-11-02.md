# Research legacy contract evidence

Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.
Scope: six legacy workflow characterization tests and a corrected test comment.
Production code is unchanged. This is not Research ownership completion.

## Verified

- Full repository gate: build, typecheck, 12,457 tests passed / 7 skipped,
  lint, re-export guard and diff check; exit 0 in 843.954 seconds.
- Final focused execution: 19 tests passed; exit 0 in 1.323 seconds.
- Actual legacy orchestration runs with mocked I/O, not a copied workflow.
  No live network or provider behavior is claimed. No providers launched.
- Negative controls removed source-URL verification, ignored the ranked engine,
  and removed abort forwarding. Each caused exactly one targeted test failure.
  An earlier control also detected removal of answer-URL verification.
  Production mutations were restored before qualification.
- Historical success with rejected citations is explicitly characterized, not
  endorsed as the physical mod's grounding policy.

## Review

Isolated Agon Codex review found false-green gaps in the source-URL union and
ranking assertions. Both were fixed and mutation-checked. Smaller findings
were also fixed: cleaned-answer assertion, fetch-signal cancellation assertion,
and the misleading old test header. No second model review was used.

## Durable receipts

Local archive: `/Users/ra/dev/modular-agon-remediation/`.
Each run ID has a `.receipt.json` and `.log`. Detailed adjudication and source
hashes: `research-legacy-contract-evidence-20261102.md`. Raw logs remain outside
shipping packages. Do not delete the archive without Raphael's approval.

| Run / artifact | SHA-256 of log (or input packet) |
| --- | --- |
| research-legacy-reviewed-full-20261102 | `8a1f9095beb4bd078560538a5d28b18914547e3f9a2c6a834ae36a439cfa036d` |
| research-legacy-final-runtime-20261102 | `ef7a71ec85ae9edb25e53c856a870e27d03004d874eb850bac77ae4604a32746` |
| research-legacy-negative-source-union-20261102 | `431de27e762a0da740a0821646609c8b3a2ec2dd49897bbcf93bbe6975d8e337` |
| research-legacy-negative-rank-result-20261102 | `81f066399196336857a05238b4b6d5aa28fac5d142ce800a65fba51213909aa1` |
| research-legacy-negative-abort-forward-20261102 | `019db4097910d2db510e78857aa4d9c5299e96968a4fab4b6f7332b8a2e4353e` |
| research-legacy-contract-review-input.txt | `d3c15fa00d0ae6063c144f538ed34ca41b6f5f5a66413ccf214bf0275115eb7b` |
| research-legacy-contract-codex-review | `d75e9e1be65c20a05a703c2e04cd5c8c09585596ffcb1e68b077baf0b5404324` |

Reproduce in isolated state with provider blockers:

```sh
npm run test:ts -- tests/unit/modular-research-legacy-contract.test.ts tests/unit/research.test.ts
npm run build && npm run typecheck && npm test && npm run lint && npm run guard:reexports && git diff --check
```

No clean-install, cross-platform, elapsed-time timeout, live-provider or full
modular release acceptance claim follows from this test-only change.
