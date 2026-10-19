# Goal / Forge integration evidence

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
