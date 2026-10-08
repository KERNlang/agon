# Combined follow-up and Plan integration

## Subject and ownership

Working candidate: `refactor/modular-plan-resume` in the isolated
`agon-plan-resume` worktree. Its committed base is `406921fd`.
The main implementation and Claude worktrees are not changed by this integration.

## Integration checklist

- [x] Inspect `dd1a3e62`, `a3f2ef61`, `38b9f1cf`, and their combined diff.
- [x] Fast-forward this candidate to `406921fd`, retaining the Plan extraction.
- [x] Apply the provider-runner guard from `53b2100f`.
- [x] Apply the mid-turn send guard from `90005648`.
- [x] Resolve the test-only append conflict by retaining both suites.
- [x] Run the combined focused Plan/display/cleanup regressions.
- [x] Run the pressure runner's own negative controls.
- [x] Run full build, tests, types, lint and re-export checks on the combined subject.
- [x] Regenerate and check the combined release set and SBOM.
- [x] Commit only the reviewed candidate changes after gates pass (`72fe2411`).
- [ ] Independently qualify the resulting committed subject.

The cherry-pick sequence was ended without a commit. The original commits remain
unchanged on Claude's branch. New test assertions and production guards were kept,
not replaced by one side of the merge.

## Evidence

Development logs are under `/tmp/agon-plan-check-ShdTwz`.

| Check | SHA-256 |
| --- | --- |
| Combined focused regression | `609e3bff7046875c3d6c7bcbfa0c3ed8b0e94e976b94d13e03f5322c7ab6c3f5` |
| Pressure runner tests | `0b555b3af94923accdcec135667d6e5d768c0ab8cf31d5302439a8b506f148db` |
| Combined full build | `23a94ff473aed910626bc004aacdea76015ecc2b29e22000eb8fd98d4e1f26a1` |
| Combined lint | `8f21e6be1a8a7ca030205b648a87a7860b27b0d706f5a92f253bde8ff5f45bd6` |
| Full suite: 6444 pass, 6 skips | `47656e4f8f5fd9a326814806feb168bde97ed2f8e2b8ac7edb5aef9d648906e2` |
| Release set check and negative controls | `93bf09c59315cb88947734231991daf66d31b3625345327777fb21f07e4a5f83` |
| Supply-chain check and negative controls | `afe0b1b9b7b3fa54781fc6b3ad5b7f02717945c0e7cb7580d93470b854b3e0d1` |
| Isolated npx fixture qualification | `40045ac44272f57e36e8b54e779c5b8e5273580723a297c93d4010e9f1d39464` |

Claude's original receipt at `/tmp/agon-pressure-h09_j0w3/receipt.json` hashes to
`0ad543974e664813f16a4ded6bda8d3ce5c2b04cb586bbb2d5a8992d2b0d4223`.
That receipt qualifies its own reported fixture run, not these added changes.
An exact copy is retained in
`evidence/modular-agon-claude-followup-pressure-406921fd.json`.
Its provider-launch claim is separate testimony; that older receipt has no
`providerLaunches` field. The combined development run uses the added guard and
has no recorded provider shim launches.

## Remaining product work

This integration does not close Plan session ownership, Brainstorm host effects,
Apply backend extraction, A15's intermittent daemon failure, or final release
qualification. Passing component tests is not complete release acceptance.

No active/global Agon installation, personal state, or provider configuration is
changed. No push or promotion is performed.

## Subsequent finding: natural Plan aliases bypassed disabled-mod checks

The production `dispatchIntent` preamble handled natural approval/resume before
the generated TUI registry path. A live-looking plan retained in the session
therefore made `go`, `continue`, or `resume` call compatibility execution while
the durable desired state disabled `agon.plan`.

Reproduction uses the real durable host and physical registry. Only execution
effects are replaced with spies. Before the fix, all three disabled cases called
execution once; three enabled controls passed. An initial fixture cleanup issue
was corrected by unsealing the fixture-owned generation directory before removal.
The clean red run has only the three intended assertion failures.

Fix: validate the corresponding `/approve` or `/plan` TUI contribution against
the active registry before natural aliases can approve or prompt for execution.
Return the registry's error without falling through to chat. This also checks
generation freshness. Do not gate read-only status: disabled producers must not
make their historical records unreadable.

Coverage includes enabled/disabled approval, paused and running resume, historical
status, and generation changes before approval or resume. No provider runs are
needed to prove this routing defect.

| Evidence | SHA-256 |
| --- | --- |
| Clean red: 3 failed disabled cases, 3 passing enabled controls | `66d4534ab71a14f00a7968a9cbfcbe6b28b4db8ea919baff8799071edd9f3471` |
| Green routing and approval regression | `d7d8022d8fa6d3378cb93af155d9728a84434a41751c69f5ed62e4f1efa749f1` |
| Expanded generation/status matrix and existing routing tests | `8e0632add36de6562ff0aaa50b17d707b3e6f58d80a52ad0b06d021a265b8f5b` |
| Full build after alias guard | `b2d5eaca3ccfa638a3c33f1452dc0d64591c0d39ffc73a531b1c76d183af4ee9` |
| Lint after alias guard | `db7a855d93ed6256de80046030db9159aeefe649b0071782bfd791125276892f` |
| Full suite after alias guard: 6456 pass, 6 skips | `e5afb7b7f6971e06f3771973e7ffaa73ac3dee21572e429aad7cdd2cdd510c0e` |
| Updated release-set check and negative controls | `93cabdff194f85fdc4675c6fbb34de05b2b739a6c3f95ba3f81baf27b8d5bdc5` |

This closes the demonstrated alias bypass, not all A05/A11 ownership work.
