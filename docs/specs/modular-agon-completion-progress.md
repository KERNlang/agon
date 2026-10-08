# Modular Agon completion: implementation ledger

This ledger continues the existing acceptance model. It does not replace the
roadmap, ownership ledger, product audit, or release criteria.

Baseline: `99d141845a779df0786e3a84860b00fb9aeaa1d9` on the isolated
`refactor/modular-plan-resume` worktree. The latest qualified code subject is
`9fc8e2af00d34dd3adb79fc1c7cd10bcb2c6d7c8`; the later commits contain evidence
and handover documentation. The combined handover remains
[modular-agon-combined-followup-plan.md](modular-agon-combined-followup-plan.md).

## Fixed acceptance scope

The current checked-in map contains 49 packages, 151 dependency edges, 872
ownership assignments, 15 kill-list entries, and 1,480 lifecycle/artifact cells.
These counts describe the specification, not migrated or accepted coverage.
The old acceptance-roadmap current-state table predates later implementation;
its exit requirements remain binding. No passing component test closes A05,
A06, A10, A11, A13, or the whole release.

Remaining classes:

- Plan session selection, approval, execution coordination, and persisted-model
  reconciliation; generation enforcement at asynchronous effect boundaries.
- Brainstorm workflow/session host effects and installed execution parity.
- Apply workflow and backend physical ownership, followed by host-adapter retirement.
- Legacy owner and compatibility-adapter removal, with negative reachability tests.
- Real mutation controls, clean-checkout release qualification, and independent review.
- External native-platform, provider, publication/signing evidence kept separate.

## Claude source review of the combined baseline

The review ran through the candidate Agon using Claude. The temporary profile
had no personal configuration. Its existing access token was read from the
keychain into process memory, never printed or saved. A macOS write-confinement
profile restricted child writes to the temporary review directory. Claude had
no tools, no MCP servers, no session persistence, and no user/project settings.
No global Agon was run or modified.

The first `agon review` run was not sufficient: generated evidence exhausted
the diff budget before production code. It is not accepted as source review.
A second `agon ask claude` review received the complete source-only diff for
`406921fd...9fc8e2af` (packages, tests, and the pressure runner).

- [Exact source-review input](evidence/modular-agon-claude-source-review-99d14184-input.json)
- [Raw Claude review](evidence/modular-agon-claude-source-review-99d14184.json)

The reviewer explicitly did not approve the whole release. Its hypotheses
require source verification. Initial adjudications:

| Finding | Source verification | Disposition |
| --- | --- | --- |
| Resume can cross a generation change during its prompt | `resumeCesarPlan` saves and executes after awaiting a choice, without another authority check | Confirmed local repair required |
| Restart retains review budget/context | Existing algorithm and characterization both retain them | Inherited behavior; inspect execution consumers before changing semantics |
| Cleanup checks only occur before a send | Initial stream and follow-up streams also check chunks; common wrapper itself does not | Review all continuation consumers; do not accept the broad claim as proven |
| Disabled natural aliases should fall through to chat | Current in-session active-plan precedence is intentional; no disk resume fallback | Not an extraction regression; preserve explicit unavailable state |
| Approve-false uses stale resume snapshot | Pending lookup returns false before any await or state mutation | Claimed mutating-false path absent |
| Provider guard is a sandbox | Guard is PATH-based; absolute executable paths/direct network are not confined by it | Keep limitation explicit; never claim sandboxing or live-provider qualification |
| Pressure-runner import/call/root errors | `os` exists; callers supply three arguments; environment and log use the same runtime root | Refuted against source |
| Windows guard support | Release scope is macOS/Linux, not Windows | Outside accepted platform scope |
| Changed bytes retain version 1.0.0 | Local artifacts are a candidate; current registry publication was not checked | Never republish these versions without registry/version qualification |
| Paused `go` is not a resume alias | `isCesarPlanResumeInput` explicitly accepts `go` | Refuted |
| Mocks accumulate across resume cases | `plan-approval-refusal.test.ts` clears all mocks in `beforeEach` | Refuted |
| Characterization was only run after extraction | Prior extraction handover records the pre-change characterization and killed mutation | Review cannot infer chronology from a diff; retain evidence |

Additional concerns (persisted malformed plans, running-session re-entry,
steering cleanup, missing per-send stream guards) remain part of the execution
audit until discriminating tests and source analysis resolve them.

The old `modular-agon-claude-followup-pressure-406921fd.json` receipt qualifies
only its named subject. It is historical evidence, not a release receipt for
this branch or any later source. Its machine-local paths are provenance, not
reproducible input paths. The combined handover already states this limitation.

## Apply backend extraction in progress

The Git backend, patch parser/inverter, and newline normalization now live in
`agon-support-worktree`, an existing dependency of core and Forge. No new
dependency edge or private import is needed. Core retains reexports and only
injects the historical undo directory. There is one backend implementation.

Temporary adapter **A13-PATCH-BACKEND**, under **KL-011**:

- Owner: core compatibility surface; physical implementation: shared worktree support.
- Paths: `core/src/blocks/patch-apply.ts`, `core/src/blocks/patch-parser.ts`,
  `core/src/utils/patch.ts`.
- Removal: migrate remaining core consumers and preserve required external
  compatibility through the final public surface; prove no legacy algorithm remains.
- Tests: `modular-patch-backend.test.ts`, `patch-apply.test.ts`,
  `git-patch-applyability.test.ts`, and the existing Apply approval/TUI tests.
- Negative control: the physical export/identity assertion failed before extraction;
  ten behavioral checks passed against the old backend. Real Git fixtures cover
  clean apply, conflict refusal, dirty detection, corrupt hunk refusal, empty diff,
  undo persistence, and restored file bytes.

This does not retire **A13-APPLY-HOST**. The approval workflow remains CLI-owned
until the next extraction. Existing backend quirks must not be silently changed
inside a movement-only commit.

### Backend review and adjudication

[Claude's complete backend review](evidence/modular-agon-claude-patch-backend-review.json)
found no introduced behavioral regression. Its
[input](evidence/modular-agon-claude-patch-backend-review-input.json) includes old
and new backend/parser sources and compatibility wrappers. SHA-256:

- Input: `a9771f5f11e148a33d8876e5b0c1afc18b24a0ffedc5309e898ca4133d38a77b`.
- Review: `18b1e5653f963ef7c9fd967865dcb437e4b3bf728e45731b976da0983b2ea986`.
- Baseline review input: `527a805c0db0f1fa254c0c39ebd447b643ee891b4238976cbebabaf0a57ad89a`.
- Baseline review output: `befc399dec7de70c5340c890eb983f5249ad733d955aeacf0e0553609a0a2b10`.

Each JSON artifact retains the exact UTF-8 text in `content` and its separate
SHA-256 in `sha256`. JSON escaping preserves raw diff whitespace without
introducing whitespace errors into source control. The hashes above bind the
stored JSON artifacts.

Own source verification:

- The old normalizer exports only `normalizePatchContent`; its body is unchanged.
- The support index exports all three moved files. Core already depends on
  support-worktree; no reverse dependency was introduced.
- New support undo functions require an explicit directory. Existing core
  signatures and historical directory selection remain unchanged. The new
  boundary intentionally cannot infer a personal home. Tests now exercise both
  entry paths with isolated directories.
- The smaller manifest type describes exactly the fields consumed. It changes
  no runtime parsing. Existing manifest fixture tests run against the reexport.
- Build preceded tests; tests use the newly built public support package.

Confirmed inherited defects, to repair separately before release acceptance:

1. Undo tokens can traverse outside the undo directory.
2. Undo inversion mishandles file creation/deletion and header-like hunk lines.
3. Undo persistence happens after workspace mutation; persistence failure can
   leave changes without the promised undo record.
4. Millisecond-only undo tokens can collide.
5. Dirty-state probe failure is treated as a clean tree.
6. Hunk counts and quoted/space-containing Git paths need parser regression tests.

Unconfined artifact reads are not automatically a security defect: Apply accepts
explicit operator-selected artifact paths, including paths outside the workspace.
That is distinct from an opaque undo token escaping its store. Do not silently
ban legitimate external patch artifacts during hardening.

Empty-manifest patches and unsupported binary/rename/mode inverse formats need
real Git characterization before changing their semantics. None of these items
is waived, and this extraction is not a release acceptance claim.

### Backend increment verification

[Development receipt](evidence/modular-agon-patch-backend-development.json)
binds staged source blobs and log hashes. Build, typecheck, lint, re-export guard,
generated-package drift, 49-package packing, SBOM, and 72 isolated npx checks
passed. The final full suite passed 6,462 tests with six existing skips. Packed
release-set size is 1,856,239 bytes. This is development evidence, not a clean
committed release receipt. The next step remains implementation, not promotion.
