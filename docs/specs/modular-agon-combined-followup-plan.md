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
- [ ] Commit only the reviewed candidate changes after gates pass.
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
