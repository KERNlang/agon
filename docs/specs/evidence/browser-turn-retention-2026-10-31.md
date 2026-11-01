# Browser turn generation retention

Runtime subject: `ff74a41ed147ac5d4bc9bb5491bee8db2484a082`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Branch: `fix/modular-browser-turn-retention`.

## Behavior

`AgonServe.handleSend` uses the existing process-authority wrapper around the
entire BrainClient generator. Its durable generation stays leased until the turn
and its cleanup finish. Cancellation acknowledgement does not release that lease.
The existing wrapper checks authority after lease acquisition and before effects.
Success is returned only after lease cleanup succeeds. No shared helper or
dependency changed.

All 49 modular package payload hashes and file inventories match the base.
Archive hashes and compressed sizes changed; they reproduce in the clean checkout
with Node26.12.1/npm11.20.0. Launcher inventory remains 137 files. Generated
release-set, SBOM and channel metadata are included.

## Verification

An exact detached checkout passed offline locked installation with scripts and
audit disabled, build, typecheck, lint, export guard, release-set and supply-chain
checks/self-tests, roadmap verification, and full runtime qualification:

- 12,119 tests passed, 7 skipped; no skip counts as a pass.
- 129 installed-candidate checks across 15 packages, including cache deletion and
  idempotence.
- 31 diagnostic tests, including a real compiler failure fixture.
- Git clean at qualification exit. Source-bearing ignored, untracked and unstaged
  contamination checks were empty.
- Zero real provider launches in every archived run.

All eight performance measurements passed on macOS arm64, Node26.12.1.
Sustained daemon transport and fixture Think load passed: 712 verified workflow
outputs, peak fixture concurrency 4, zero pending fixtures. Failure, cancellation,
recovery, shutdown and process-cleanup controls passed. This load gate measures
shared daemon/workflow behavior, not Browser HTTP throughput. Final Git and
source-contamination checks stayed clean.

## Regression evidence and review

Seven tests in `tests/unit/modular-browser-turn-retention.test.ts` cover manual
lease controls, completion, failure, delayed cancellation cleanup, real BrainClient
completion/cancellation with a fixture engine adapter, and generation change during
lease acquisition. Real loopback HTTP and durable generations are used. Collection
is previewed, never applied. Removing the lease originally allowed collection
during an active turn and failed the regression.

Isolated Agon Codex review found no confirmed introduced defect. Its requested
cancellation/real-BrainClient evidence was added and verified locally. Existing
shared lease-failure tests also passed. Review packet SHA-256:
`a1e4d05a6c756a0523b5599bf289ab168b383ad0632068ee23c09d840350a903`.
Review log SHA-256:
`944c43a676a3fde2de681af9499392c034747e35e64d286768f4395cf9c8a4d0`.
Full adjudication: `browser-turn-retention-review-adjudication-20261031.md` in the archive.

## Durable evidence

Archive: operator-owned `modular-agon-remediation`, outside Git worktrees.
Each ID identifies a `.receipt.json` and `.log`. Receipts retain exact commands,
exit codes, timing and provider records. Verify logs against these SHA-256 hashes.
Never delete the archive without Raphael's explicit approval.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| browser-turn-retention-red-20261031 | Expected regression failure | 962c9272ddbc08708ede8cf0d859aeab385f97be79b6e4d14791f8fda6210ca4 |
| browser-turn-retention-cancel-drain-20261031 | Sandbox denied loopback; not acceptance evidence | 4f07f7b65a6d50dfbdb0233e04e9e28765b15069903108d1775bab6a1e4a59ed |
| browser-turn-retention-real-brain-20261031 | 10 focused tests and quality gates passed | df35edc22083393ab2d08ff1d5bc27e6182c0cd3765d389642fe94fb37f0efcd |
| browser-turn-retention-full-build-20261031 | Working build passed | 0dfd67ce590389f40362e88ba9e99a1dedaba85ad9ed2abdaf81c265c7b95570 |
| browser-turn-retention-full-runtime-20261031 | Working runtime passed | 25168c962ec5762f83325dee7e1473cbca853818fcb9506db5a435935f5d5357 |
| browser-turn-retention-clean-build-20261031 | Exact-commit build passed | f8119801a23834cdc451cecfe2cb61625daf9023524d392cab7f3356965478b3 |
| browser-turn-retention-clean-runtime-20261031 | Exact-commit runtime passed | ba0be11c107d4ad2064cbd37955792dc2ecdd2b5a5ce71fed28a0e0c803346a9 |
| browser-turn-retention-clean-perf-load-20261031 | Exact-commit performance/load passed | ae6b71ac628c58eca56310b8b21891b7c6af01deac89903efd801dc9c50cb99c |

## Limits and integration

This is a bounded retention repair, not full modular acceptance. PR375's separate
Browser admission checks are not included or assumed merged. When combining them,
preserve post-queue admission and the full-turn lease; run both regression suites.
No live extension/provider, other native platform, global installation or promotion
is claimed. Existing no-boot compatibility and bounded server shutdown behavior
are unchanged; this slice does not prove a stronger shutdown guarantee.

Separate confirmed follow-up: drive, Chrome handler and mod-browser discard HTTP
error bodies, hiding the helper's completed-effects/do-not-repeat warning. None
of those paths automatically retries. Preserve bounded recovery guidance in a
separate fix with all three consumers tested. Do not count that issue as resolved.
