# Recovery installation validation

Date: 2026-10-30. Runtime subject:
`5ccd86d90937af2951bf357fc56babc94e7d701a`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
This index is separate from the executable subject.
Status: clean committed runtime qualification passed; ready for review.

## Scope

Approved generation recovery previously selected a retained generation even
when its installation prefix was absent. The next installed launch then failed.
Shared rollback now validates managed metadata under the host writer fence
before changing the pointer. Managed lifecycle reads reuse this validation.

Generation artifacts come from hash-checked host reads. Prefix IO remains a
separate injected boundary. An incomplete index cannot disguise a managed
installation. Generic installation descriptors remain supported. A malformed
current pointer does not prevent explicit recovery to a valid approved target.

No dependency or lockfile change. Only the kernel payload changed among the
49 modular packages. Release metadata and embedded launcher identities were
regenerated. The package graph remains at 158 edges.

## Verification

Development checkout: build, types, lint, re-export guard, release-set and
supply-chain selftests pass. Full suite: 12,120 passed, seven skipped.
Installed verification: 135 checks passed, including refusal while the target
prefix is absent, unchanged pointer, continued launcher operation, approval
after restoring that prefix, actual Provenance dispatch, and re-entry.

Negative controls: two CLI regressions failed before implementation. Two review
findings also failed before correction. The full suite caught overbroad detection
of an existing generic descriptor; that existing test stayed unchanged and passed
after correction. No test or acceptance criterion was weakened.

Exact committed clean checkout: offline locked install, build, types, lint and
re-export guard pass. Git stays clean. Source-contamination checks report no
ignored, untracked or unstaged source before or after build, without added
exclusions. Clean runtime passes: 12,120 tests, seven skipped, 135 installed
checks and 31 supplemental real-compiler tests. Post-runtime contamination is
also empty. All 15 runtime/build receipt log hashes were verified; provider
launch records are empty. The default skips cover live providers, unavailable
Go/pyte tooling and the separately exercised compiler test.

## Evidence

Raw logs and receipts remain outside Git in `$MODULAR_AGON_EVIDENCE_ARCHIVE`.
Each run ID names adjacent `.receipt.json` and `.log` files. Receipts record
commands, exit codes, durations and log hashes. Preserve failed runs and archive.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| `recovery-installation-red-20261030` | Two expected failures | `66d75ef918ca8df51faea6658bc4e48a4a5b4bf47fd257b2ef8cd749242425a8` |
| `recovery-installation-review-red-20261030` | Both review findings reproduced | `5fade288c54fa06366fc30d14d92fec259fb2b0861a4ff96eea9efe444c87903` |
| `recovery-installation-full-20261030` | One generic-descriptor regression found | `3975fd541efdcc62ec460dfa32de451946cff0a5aa3fa730a3631599175a1b87` |
| `recovery-installation-generic-compat-20261030` | 66 targeted tests pass after correction | `15991060f17c133de767e192981a0a038dd421f4d74102174523c608ced16b4c` |
| `recovery-installation-compatible-build-20261030` | Final build and hygiene pass | `5b4f7394dc542351f2a534ae1160a83e4f9ebfb85ec7df837ef07d109433ab50` |
| `recovery-installation-compatible-full-20261030` | Full suite and 135 installed checks pass | `595fcf12dca139da27008b3495225f3bc724bbccd319e5b5c16960868aeca032` |
| `recovery-installation-clean-build-20261030` | Exact commit builds cleanly | `3ac1f9edcd4872cf157c7b5ccb5c7edcd81c47e8d6bac818db0024ee2141c9c2` |
| `recovery-installation-clean-runtime-20261030` | Full suite, 135 installed checks, 31 compiler tests pass | `77023cf9db987028b010253b48acd2d407cc97dac4ee1219d1978ae9bb931150` |

Earlier attempts remain archived: `recovery-installation-focused-20261030`
used stale built kernel imports; `recovery-installation-runtime-20261030`
omitted the offline cache override; `recovery-installation-runtime-cache-20261030`
hit the tool sandbox's Unix socket restriction. None is recorded as a pass.

## Independent review and limits

Isolated Agon Codex review found two confirmed defects: incomplete index
detection and generation reads through the wrong IO boundary. Both were fixed
and checked with fail-before/pass-after tests. The reviewer did not run tests.
Input SHA-256: `da2e4ebeaa2c85a40173241f693df63188d3c90154a55e3572146c5fcbf12916`.
Review log SHA-256: `a6e71415b3af554d400658df47f03252413c05811b759594c7ff7627bd8d29cb`.

This verifies installation metadata and prefix availability, not every installed
package byte. Stable-launcher recovery from a malformed current pointer remains
separate work. Native evidence is macOS arm64, Node 26.12.1. Other platforms,
live providers and publishing/provenance remain unqualified here. Full modular
acceptance is not claimed. Active/global Agon and personal state stay untouched.
