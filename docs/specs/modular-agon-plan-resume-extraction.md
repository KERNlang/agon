# A05/A11: Plan resume-policy extraction

## Scope and ownership

Candidate worktree: `/Users/ra/dev/agon-plan-resume`.
Branch: `refactor/modular-plan-resume`, based on `90fa66d7`.

The physical `@kernlang/agon-mod-plan` package now owns:

- `buildResumePromptContext`: progress counts, failed-step selection and remaining estimates;
- `skipCompletedSteps`: completed-work preservation, dependency blocks and exhausted-review handling;
- `prepareCesarPlanResume`: the resume/restart state transformation and restart cost reset.

The implementation is `packages/mod-plan/src/resume-policy.ts`. It imports only
the package's own types. It does not access files, session stores, providers, UI
callbacks, kernel internals, or global state. Public exports and their generator
are updated together. The CLI already declared this package dependency; no new
dependency or cycle was added.

`resumeCesarPlan` remains responsible for user choice, display, persistence and
execution, but delegates state preparation through the package entrypoint.
The moved implementation is removed from the CLI, not copied alongside it.

## Compatibility seam and removal condition

Current candidate update (2026-10-11): the two CLI re-exports below are removed.
Consumer tracing found no production caller; the characterization test now
imports the public Plan package directly. A negative regression rejects their
return through CLI queries. Public Plan exports and policy behavior are unchanged.
This retires A05-RESUME-POLICY only, not the global KL-011 entry. The sections
below retain the original extraction's historical subject and evidence.

Owner: `agon.plan` / existing A05/A11 Plan extraction under KL-011.
Seam ID: **A05-RESUME-POLICY**.

At the original extraction, `packages/cli/src/signals/dispatch/plan-queries.ts` retained two re-exports so the
existing `signals/dispatch.ts` barrel and its consumers do not break. The tests
assert these are the exact package functions, not a second implementation.

Delete this seam when all consumers of the old dispatch barrel use the physical
package's public exports. Preserve the old barrel until that migration is verified.
This is a scoped adapter retirement condition, not closure of the global KL-011 entry.

## Behavior pinned before moving code

The characterization tests first ran against the original CLI implementation.
They cover empty plans, mixed step states, review cycles 0–3, retained context,
costs, exact step/result fields, input non-mutation and raw execution inputs.
Existing approval/refusal tests remain unchanged; new checks strengthen their
saved-plan and executor-input assertions for both resume and restart.

Compatibility details are intentional in this extraction:

- Completed steps become skipped on resume; already-skipped steps remain skipped.
- Failed review steps stay failed after two review cycles; other failed steps reset.
- Blocked steps remain blocked on resume.
- Restart resets actual cost/token totals and step results, not the entire historical envelope.
- Existing timestamps, context and review-cycle counters are retained as before.
- No new approval alias, disk fallback, cancellation rule, or execution route is introduced.

The public-ownership test failed before extraction because the package did not
export the policy. It passes after the physical move.

## Negative control

Changed the actual implementation's exhausted-review threshold from `>= 2` to
`>= 3`, rebuilt the package, and ran the policy/caller tests. Three tests failed,
including the real CLI resume path's saved/executed envelope check. Restoring the
threshold and rebuilding returned the focused suite to green (47 tests).

This is one killed implementation mutant, not a whole-project mutation score or
closure of A10. No oracle or timeout was weakened.

## Evidence location

Logs: `/tmp/agon-plan-check-ShdTwz`.
The runner uses isolated temporary homes/caches/prefixes from
`pressure_modular.py` and the existing provider/browser launch guard. The guard is
not a security sandbox. Full suites run without a concurrent suite or lint job.

| Evidence | SHA-256 |
| --- | --- |
| Baseline full suite: 6406 pass, 6 existing skips | `db8c7f76b1e1db51a57d54c6308e4f784486216ddd6a087d3d842e05c561680a` |
| Original CLI policy characterization | `2aa7ae109ae698a4ac3a6d311b62f0d669ccede8db7ed2b8746af7bf00cfea9b` |
| Original CLI restart/resume raw envelopes | `d97308660c3ffeb3741e5911ce71451f8bee80b03aa2a19d97670672adc71b9f` |
| Missing physical ownership: expected failure | `44914249b05f6f12cc2260ee66bac5fdcbf9ee4938f40a4a0aff85f4c63355d2` |
| Review-limit mutant: three expected failures | `96bd884e6e43ecceb7f6558c8d7dd4a1459563a568a2e0980e781b43241bffc9` |
| Restored focused suite: 47 pass | `ba13b20080babe92c3ab505d96ba637ea3706b5fa3ad87ca43eec8005198cf2c` |
| Final full build | `7e151364a968caf07066da9d1442363a0928ff4aa6f0cedb11384add7c2e90a3` |
| Final full suite: 6417 pass, 6 existing skips | `ed111a088b4b8ff7117a4fdc8574bbdb209667e1b288da68d529b3b67ecd4c86` |
| Final typecheck (incremental, after full build) | `be1cf12bc2c9d30c2cc1484ecb5ad9f709e037352543b5aeaf93337177ed2a06` |
| Final lint | `466378f218489e30c8fccc75940b5a5ca276ce324e9e3ce98a12444e7bd0d3ed` |
| Re-export guard | `de95be878ed3034819e11e168353c9f410a639a5c6304bc61e26718877a0291a` |
| First-party generator consistency | `d4f6d6eaaf2a06407d8bd6ade8c7c197929f5d19226bf328f7c2c82ef5d6a829` |
| Plan package dry-run contents | `5c39579252c09ed56ea327ace51d8090eee6b8a6cc59103191638420994ffb1d` |

The pack dry-run contains 14 entries, including the new public declaration and
the bundled implementation. Compressed size: 13,030 bytes; unpacked: 65,990 bytes.
This is working-tree development evidence, not a clean committed release receipt.
Temporary logs must be retained before treating their hashes as durable evidence.

## Integration and remaining work

This candidate does not include Claude's cleanup repairs, daemon diagnostics, or
the separate follow-up display extraction. Its changes do not touch their files.
Integrate only this delta, preserving the other work, then regenerate and verify
the combined release evidence. No generated release/SBOM receipt was copied over
the integration branch.

Queued separately: Claude's `integrate/followup-display` branch through
`406921fd`, plus the still-separate provider/Cesar guard branch. The reported
6,430-test result belongs to that other subject; it is not this candidate's
verification result. Review and combine those changes only after this extraction.

**A05/A11 remains open.** Session selection, approval policy, persistence effects,
execution coordination and retirement of `A05-PLAN-SESSION-HOST` are still separate
work. This increment removes real policy ownership from CLI code but does not
claim the entire Plan feature or Modular Agon is finished.
