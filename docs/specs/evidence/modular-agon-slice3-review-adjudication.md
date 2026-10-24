# Modular Agon S3 review adjudication

## Review boundary

Agon Think, Brainstorm, Tribunal, and independent review ran with disposable
`AGON_HOME` state and explicit localhost-only wrappers. The successful review
voices were two distinct local model configurations: Qwen3 4B and Qwen3 14B.
The Tribunal's optional Claude summarizer encountered expired authentication and
produced no synthesis; it is not counted as a review run or as evidence.

Every model statement below was checked against the staged source and tests.
Confident language without matching source evidence was rejected.

## Real findings fixed

1. **Campfire was absent from the generated UI hierarchy.** The ownership
   generator now includes it, the checked hierarchy was regenerated, and the
   consistency gate requires all 36 user-toggleable mods exactly once.
2. **Applied-profile hashes were only shape-checked.** The kernel now recomputes
   the canonical profile-definition hash and rejects a forged snapshot; a
   negative control mutates the hash.
3. **The package closure omitted a default-enabled hidden support package.** The
   closure now seeds every default-enabled kernel/support package. Full
   compatibility resolves 48 of 49 packages; only optional SaaS support remains
   absent.
4. **UI projection manufactured a fake profile-update plan to discover effective
   mods.** A pure `resolveDesiredState` boundary now performs catalog membership,
   disabled-dependency, effective-mod, and package-closure resolution.
5. **Apply's outer preview check did not itself close the writer-fence race.** S2
   generation commit now accepts `expectedBaseGeneration` and rejects a stale
   base after acquiring the writer fence. A two-preview race is a discriminating
   test.

## Tribunal findings

| Finding | Adjudication | Local evidence |
| --- | --- | --- |
| TOCTOU may remain | Refuted after fix | `ModActivationService.apply` checks pointer/hash before building; `DurableModHost.commitGeneration` checks expected generation inside the writer fence; stale winner/loser test stays on generation 2. |
| Reverse cascades may leave dependents | Refuted | All 36 disable roots are exercised; selected transitive dependents are removed; `noCascade` refuses whenever the reverse closure is non-empty. |
| UI could misstate schema/dependency status | Refuted | UI derives from `resolveDesiredState`; generated drift, physical-mod membership, parent dependency, exact-once coverage, blocked reasons, and disabled reachability have executable checks. |
| Rollback and partial writes may be untested | Refuted | S3 activation rollback restores exact desired state; the inherited S2 crash, journal, pointer, snapshot, and rollback suites remain mandatory in the S3 clean qualifier. |
| Profile snapshot may omit arbitrary runtime files | Out of scope, documented | S3 snapshots desired state and profile expansion. Runtime/package artifacts are generation-owned by S2/S4+, not profile-definition fields. |
| 5 ms budget may fail under 1,000 concurrent applies | Not an S3 performance claim | The S3 budget covers pure planning and grouped-view projection. Concurrent durable writers are covered by S2; distributed high-load qualification remains S9. |
| Accessibility requires verification | Refuted | Semantic labels, unique focus order, keyboard navigation, textual status, disabled/blocked recovery, and a removal negative control are tested. |

## Independent review findings

| Finding | Adjudication | Local evidence |
| --- | --- | --- |
| `keyboardIndex` may repeat across groups | Refuted | The counter is declared once before the group map and incremented for every entry; the accessibility test compares set size with all entries. |
| Temporary checkout cleanup may race | Refuted | Each qualifier creates a unique `mkdtempSync` directory and removes only that directory in `finally`; cleanup failure fails qualification instead of producing green evidence. |
| Missing UI mods lack error handling | Refuted | Unknown entries fail immediately and a final catalog-minus-seen check rejects missing mods; the S3 negative control adds a canary mod and requires failure. |
| Performance ignores GC pauses | Refuted as a blocker | Qualification launches Node with `--expose-gc`; the measured loop intentionally does not force collection between iterations, so naturally occurring pauses remain in the sample. |
| Generated artifact validation is incomplete | Refuted | The qualifier runs generated drift, spec consistency, roadmap, package graph, projections, pack contents, and clean-checkout materialization. |
| Freeze/Set/error-message nits | Rejected | Freeze establishes externally visible immutability; Set expresses uniqueness directly; the cited `activation-service.js` source path does not exist. |

The security reviewer reported no actionable issue but incorrectly claimed that
the S3 negative-control script contains XSS tests. It does not; that sentence is
rejected and is not used as evidence.

## Outcome

No locally actionable review finding remains. The accepted fixes are covered by
tests that would turn red if the corrected behavior regressed. Raw model outputs
and status files are retained under `verification-logs/slice3/`; their claims are
not authoritative without this adjudication.
