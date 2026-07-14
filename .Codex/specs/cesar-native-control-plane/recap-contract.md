# Cesar Recap State and Visual Contract

**Status:** IMPLEMENTED AND LOCALLY VERIFIED — not pushed  
**Date:** 2026-07-13  
**Confidence:** 0.99

## Current Layout — Verified

- **Live rail:** one single-border panel in the existing bottom chrome. Its header shows `LIVE`, phase, elapsed time, tool count/failures, file/change count, queue count, and `Ctrl+E` tool expansion. It has a `now:` row and at most five timeline rows (`packages/cli/src/kern/surfaces/status.kern:300-385`).
- **Final recap:** a separate `◆ Cesar recap` block containing outcome/mode/confidence/duration, consequential failures, changes, verification, todos, tools, files, checkpoints, diff preview, and warnings (`packages/cli/src/kern/blocks/engine.kern:178-285`).

## Screenshot Regression — Verified

- **VERIFIED:** The screenshot shows `compile failed`, `build failed`, and `typecheck failed` whose reasons begin `[Investigation phase] Bash command skipped`, while the same recap also shows successful verification. A policy skip is therefore presented as both a red failure and a green pass.
- **VERIFIED:** The screenshot shows `0% confidence` on a turn whose tool summary contains no Confidence tool. `recordCesarRecapEvent` applies `Number(event.value)` to `null`, which yields zero (`packages/cli/src/kern/cesar/recap.kern:133-136`).
- **VERIFIED:** Failed tools and red lines are currently derived from raw `status=error`; exact tool+input deduplication cannot reconcile an equivalent later command (`packages/cli/src/kern/cesar/recap.kern:101-124`, `packages/cli/src/kern/cesar/recap.kern:286-359`).

## Terminal Classification

Every tool terminal must be classified before recap aggregation:

| State | Meaning | Recap treatment |
|---|---|---|
| `succeeded` | Tool really executed and succeeded | Eligible positive evidence |
| `failed` | Tool really executed and failed | Red only if unrecovered and consequential |
| `skipped_policy` | Investigation/plan/read-only policy prevented execution | Not a failure and not verification evidence; hide in clean recap |
| `denied` | User or explicit permission rule denied execution | Show neutral/amber waiting or blocker only when it stopped completion |
| `cancelled` | Turn/tool was cancelled | Derive from terminal turn state; never call it a command failure |
| `recovered` | A later equivalent action satisfied the same terminal condition | Suppress the earlier failure from the clean recap |
| `unknown` | Legacy/unclassified terminal | Fail closed in diagnostics; do not invent pass evidence |

Output-string matching such as `[Investigation phase]` is a compatibility fallback only. New events carry a structured terminal reason from the policy/executor.

## Verification Reconciliation

- Verification identity is the logical label (`compile`, `typecheck`, `build`, `tests`, `lint`) plus relevant scope, not exact command text.
- Only commands that actually executed contribute pass/fail evidence.
- The final executed attempt for that logical verification identity wins.
- If an earlier command failed and a later equivalent command passed, the clean recap shows only the pass.
- If every attempt was policy-skipped, render `verification: not run` only when verification was required for completion; otherwise omit it.
- A genuinely final failed verification produces one concise red line, not both a failure line and a second contradictory verification row.

## Confidence Contract

- `null`, `undefined`, missing, stale-turn, or non-finite confidence remains absent.
- `0%` is rendered only when the active turn explicitly called ReportConfidence with a valid zero.
- Confidence from an expired lease epoch cannot appear in a newer recap.

## Exact Clean Recap

Successful no-diff verification:

```text
◆ Cesar recap
✓ Done · self · 32.7s
  workspace: unchanged
  verified: ✓ compile · ✓ build · ✓ typecheck · ✓ tests
  18 tools · 1 skipped
```

The `skipped` suffix is optional neutral detail and is omitted when it adds no diagnostic value. It is never red.

Successful changed workspace:

```text
◆ Cesar recap
✓ Done · self · 41.2s
  workspace: +1 created, ~3 edited
  verified: ✓ typecheck · ✓ tests · ✓ build
  files: + src/new.kern, M src/runtime.kern, M tests/runtime.test.ts
```

Required verification never executed:

```text
◆ Cesar recap
◐ Partial · self · 18.3s
  workspace: unchanged
  verification: not run
  remaining: leave investigation mode and run the project gate
```

Genuine final failure:

```text
◆ Cesar recap
✗ Failed · self · 24.1s
  build: ✗ npm run build → TypeScript compilation failed
  remaining: fix the compiler error and rerun build
```

## Preserved UI

- Keep the recap placement, width behavior, indentation, and existing diff/checkpoint expansion.
- Keep the live rail placement, single border, `Ctrl+E`, and five-row timeline cap.
- Keep correlation IDs out of the default view; show them only in diagnostic expansion/replay.
- Use green only for authoritative completion/pass, amber for partial/waiting/not-run, and red only for an unrecovered terminal failure.

## Acceptance Criteria — implemented locally

- [x] Replaying the screenshot events produces no red compile/build/typecheck lines for investigation-policy skips.
- [x] The later successful compile/build/typecheck results appear once as green verification evidence.
- [x] The headline is `Done` only when the settled task terminal condition is met.
- [x] A policy-skipped required gate with no later execution produces `Partial` plus `verification: not run`.
- [x] Null confidence is omitted; an explicit ReportConfidence value of zero still renders `0% confidence`.
- [x] There is never a contradictory red failure and green pass for the same logical verification scope.

**Expected visual diff:** after reload, the screenshot’s contradictory red policy failures and fake `0% confidence` are gone; a fully verified turn renders as one compact green Done recap.
