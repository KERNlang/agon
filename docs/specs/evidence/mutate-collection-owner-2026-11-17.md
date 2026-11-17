# Mutate collection owner

Prerequisite: PR431, f642ec845b58568bcd2f32edd872a15cf6fcdf1e.

The legacy semantic collection body now belongs to mod-mutate. Forge preserves
its public signature and supplies the same Core loadConfig function. The only
body change passes that runtime to the existing support-panel preflight.
Target filtering, prompts, permissions, retry, cancellation, event order,
validation, rejection warnings and panel health remain unchanged.

The modular support-worktree semantic path remains separate. It has different
prompt, validation, budget and reporting contracts. This extraction does not
claim convergence or full modularization/release acceptance.

Verification before independent review:

- Unchanged base: build/types/lint/re-export guard passed; 13,121 tests passed,
  seven skipped. A sandbox-restricted attempt was stopped after local socket
  EPERM; the same socket probe passed outside the sandbox.
- Seven collection characterizations passed before extraction. Twelve pass
  afterward, including four real Node subprocess fixtures for success, retry,
  timeout and cancellation. Those four also pass on the original collection.
- Restoring the original Forge collector makes the delegation oracle fail;
  restoring the facade makes it pass. The collection body is byte-identical
  after normalizing the one preflight runtime argument.
- Initial full run: 13,129 passed, four generated-metadata failures, seven
  skipped. Refreshed roadmap, ledger and kernel graph; updated the nine exact
  qualification counts from 157 to 158 for the new internal dependency.
  All 53 graph/ledger tests now pass, including missing/extra/duplicate controls.
- OSV: 30 existing advisories in 13 unchanged external packages (two critical,
  11 high, 15 medium, two low). No external version or package was added.

Final verification:

- Corrected the two old edge-count values in the platform-test fixture after a
  second full run exposed that remaining mismatch. The final full suite passed:
  13,133 tests, seven skipped. Build, types, lint, re-export guard, docs parity,
  first-party metadata, release/supply-chain self-tests and all-generated checks
  passed. Failed attempts remain in the local run history.
- One Agon review: Codex and Kimi both completed without blockers. Recomputed
  the reported assignment hash and confirmed it is valid; its locators refer to
  the frozen legacy inventory. Restored the facade's sandbox invariant comment.
- After all builds, actual Forge/mod-mutate tarballs passed strict consumer
  compilation, missing-declaration rejection and runtime checks. Old and new
  collection exports produced identical results and dispatch requests. Other
  dependencies use local builds; this is not a clean distribution install.
- Last live check: all 12 collection tests passed, including local subprocess
  success, retry, timeout, cancellation and child cleanup. No live providers.

Local receipt: mutate-collection-final-receipt-20261117.json in the existing
modularization evidence workspace; the tracker records the published commit.
