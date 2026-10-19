# Goal / Forge integration evidence

## Shared engine accounting follow-up

Date: 2026-10-19. CLI and MCP engine services now return the existing tracker's
cache-aware cost estimate and usage source when dispatch returns usage. Review
can consume those estimates on successful and failed calls. Missing usage stays
absent at the host; it is not recorded as measured zero. No price table or
dependency was added. TokenTracker rejects invalid counts and source values
before changing shared accounting.

Isolated Codex review `modular-dispatch-cost` identified malformed-usage
contamination and test-state leakage. Both were corrected and verified locally.
Review packet SHA-256:
`0c6f478dadbe8e229898b8a5c36d72f6dd3e38eba2eaf7955b1146bd6154b6e3`.
Review log SHA-256:
`5a515ee467eebfd21dcfbb9eb6c41184d7a2fb941ff3b786fce96de80e6a81f3`.
The temporary authentication copy was verified absent after review.

Receipts remain in the durable local directory named below:

| Receipt | Result | Log SHA-256 |
|---|---|---|
| token-tracker-invalid-usage-red-corrected | Seven missing-rejection failures before validation | 708198edcda28820f8f7f519fe175da90d8db40d80f7929ee54f03b4c0d8dcde |
| modular-dispatch-reviewed-host-controls | 130 tests, types, full lint and re-export guard passed | 5d9f1b05b8af714b70ecdd46cb104e8bd0ba0530ef60a3e8bf7db6af4611ff4b |
| modular-dispatch-reviewed-full-gate | Full gate passed in 832.038s; 10,636 tests passed, six skipped; zero provider launches | 789504c382a55b299db7fa35bdc18696f991acc7d013af4d64b6971ad09e3ae1 |

The earlier `token-tracker-invalid-usage-red` receipt is retained but rejected as
negative-control evidence: it failed from a missing test import, not the defect.
The corrected run above failed on the intended assertions. Host controls use
the real tracker and CLI/MCP services with adapter dispatch mocked. They cover
malformed usage, exact fallback cache pricing, coding-plan zero and Review
consumption. They do not establish live-provider billing accuracy.

Limits: `costSource` describes token provenance, not verified billing rates.
Unknown engines can use fallback prices. Review still maps absent usage to zero;
Goal's auxiliary accounting and Think parity remain unfinished. The full gate
tested working-tree source, not a clean committed release candidate. Native
platform and npm provenance cells remain separate. No global install or push.

Date: 2026-10-19. Development increment, not release acceptance.

Goal now calls the existing Forge workflow for competitor execution, synthesis
and oracle red-team probes. The approved internal dependency is
`@kernlang/agon-mod-forge@1.0.0`. The package graph has 49 packages and 156 unique
edges. No external dependency version changed.

The increment preserves explicit competitor rosters and uses existing routing
policy for default rosters. Repair attempts use the full roster. Returned
usage enters the existing cost ledger. Completed Forge runs can be recovered
after process death before Goal accounting, without charging them twice.
This does not establish recovery of every interrupted provider call.

## Verification receipts

Durable local logs and receipts are in
`/Users/ra/dev/modular-agon-remediation/`. Receipt names below omit `.receipt.json`.
The failed sandbox run is retained, not overwritten.

| Receipt | Result | Log SHA-256 |
|---|---|---|
| goal-forge-routing-full-qualified-environment | Full gate passed, 815.633s, 10,609 tests passed and six skipped, zero provider launches | b95243603d1291eae937e4f97778c6f030e3b24bcab99f09b8155ba44e6cc472 |
| goal-supervisor-reviewed-contract | Follow-up test changes: 56 tests, types, focused lint, diff check passed | 752b8d466452a9eef2b864031efffc57c7dc5333d12cb34985394c2aee15591e |
| goal-forge-final-roadmap | Roadmap and diff checks passed | bf5a42803a260abfdb40173a14cd38150ae59474ddd30bb3520eba6922ff627b |

Full gate command:

```sh
npm run spec:modular-first-party:check && npm run spec:modular-generated:check && npm run build && npm run typecheck && npm test && npm run lint && npm run guard:reexports && npm run test:modular-release && npm run test:modular-supply-chain && git diff --check
```

The gate ran in isolated state with provider/browser blockers and local
socket/watch permissions. The preceding sandbox run denied those operations.
Setup tests also found stale launcher inventory after rebuilding; regeneration
through the existing release-set generator corrected the inventory. Neither
daemon assertions nor package containment checks were weakened.

## Independent review

Isolated Codex reviews: `goal-oracle-recovery`, `forge-synthesis-accounting`,
`goal-default-routing`, and `goal-supervisor-contract-delta`. Raw packets,
reviews, adjudications and hashes remain in the durable local archive and
`goal-controller-parity-audit.md` there. Temporary authentication copies were
removed after review.

The last review confirmed that the exact `tasks` and `commit` CLI additions
repair supervisor input loss. Follow-ups assert that those names are absent in
the legacy baseline and feed actual supervisor argv through the generated Goal
route on both initial execution and restart. Existing real-worktree tests prove
default commits and explicit commit refusal. No broad extra-argument exemption
was introduced.

## Limits

The full gate tested working-tree source, not a clean committed release subject.
The follow-up changed only tests and roadmap prose. Fresh clean-checkout and
installed-candidate qualification remain required. Remaining work includes
mid-provider interruption recovery, artifact-write accounting, other auxiliary
provider accounting, legacy Goal owner retirement and subject-bound reviews.
Unavailable native runners and npm publishing provenance remain external cells.
The active/global installation was not changed. Nothing was pushed or promoted.

## API agent artifact-write follow-up

Both API agent methods previously threw after a completed model call when the
output file could not be written. The caller lost returned usage. Two real
filesystem EISDIR fixtures reproduced this. A shared private adapter method now
preserves usage and partial output in a failed result; cancellation and timeout
retain their exit codes and reasons.

Independent Codex review raised a health-classification risk. Six tests proved
that a path containing `unauthorized` could quarantine a healthy engine. Health
classification now receives the provider result before local write errors are
appended. Ten artifact-failure controls cover both methods, all terminal states,
existing provider fault flags, filesystem details and actual health state.

`api-artifact-reviewed-full-gate` passed in 831.591s: 10,619 tests passed, six
skipped; build/types/lint/generated/re-export/release-set/supply-chain checks
passed with zero provider launches. Log SHA-256:
`7363cc7a26a7d4b36c22e5c88bc6ae09882832283759699592a3091f10e8b1e5`.
Release metadata was regenerated after the build, before the full tests.

Independent review packet SHA-256:
`42b16ed0937bf9debbfdac55f1eb5f63e75270073cb960c60b2123bf699a256f`.
Review log SHA-256:
`f46b6e20168796ff4973ef20eebf35fbd02956ad21e99b32cb7ce2e55c99f738`.
Raw review, red/green controls and full-gate receipts remain in the same durable
archive. Temporary review authentication copy was removed. Other dispatch paths
and the shared Review/Goal cost contract still need qualification; this fix does
not establish complete accounting or release acceptance.
