# Legacy Mutate host owner

Base: 277002a8e, PR #432 (depends on #431).

Move legacy pool policy, hydration and execution orchestration into mod-mutate.
Forge keeps its public signature and five existing target/collection/sandbox/report
bindings. The moved bodies match the base after signature and binding normalization.
Core worktree functions were reexports of the same support-worktree functions.
Modern support-worktree assessment/candidate APIs remain separate: their target,
prompt, validation, deadline and report contracts differ.

Verification before review: full build, types, first-party generation and all
modular generated checks pass. Focused suite: 79 passed, one skipped. Both new
ownership tests fail against the original Forge implementation and pass against
the facade. No external dependency change. Final full gates and packed runtime
qualification follow review; no broader release qualification claim.

## Final verification

Full build, types, lint, re-export guard, docs generation, first-party generator,
all generated-artifact checks and release/supply-chain self-tests pass.
Final serial suite: 13,135 passed, seven skipped. Final focused run: 60 passed.
One Agon review, codex/kimi, both succeeded; no blockers. Namespace-spy coupling
fails loudly and is covered by the old-host negative control. Dual pool exports
are required compatibility reexports with identity checks. No repeat panel.

Actual Forge and mod-mutate tarballs pass strict external TypeScript consumption,
public identity and semantic dispatch parity. Removing legacy-workflow.d.ts fails
compilation. Five real Git/filesystem/subprocess runs pass: success (4 killed),
baseline failure (4 not run), partial cancellation (1 killed, 3 not run), running
cancellation (1 not run), timeout (1 killed by timeout). Each verifies source
restoration, worktree removal and serialized report contents. Zero providers.
Other package dependencies use local builds; not a clean distribution install.

## Retained failures and qualification limits

The broader test:modular-first-party check fails on Campfire: its manifest omits
host/input/runtime/session-workflow declarations included by npm pack. All15
tracked Campfire inputs match main byte for byte. This separate packaging defect
is not fixed by the bounded Mutate extraction; no full first-party packing claim.
That checker rebuilds packages and was initially run alongside full tests. Four
workflow-plan-mode tests failed in that overlapping run. All9 pass in isolation;
the final complete suite passes after rebuilding and running serially. No source
change was made for those failures; the overlap explanation is inferred.

The existing30 OSV advisories across13 unchanged dependencies remain (2critical,
11high,15medium,2low). No release-security or broader modularization claim.

Durable local evidence: ~/dev/modular-agon-remediation/mutate-host-owner-final-receipt-20261117.json
contains hashes, run counts and packed results. Logs use mutate-host-*20261117.
Review run: review-1794921390674-gpe6pq-mutate-host-owner-20261117.
Packed fixture: ~/dev/modular-agon-remediation/mutate-host-packed-yNCAmg.
