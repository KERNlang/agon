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

## Apply backend extraction — `34e094d3`

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

This backend-only commit did not retire **A13-APPLY-HOST**. The following
increment moves the workflow. Existing backend quirks were not silently changed
inside the movement-only commit.

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

## Apply workflow extraction — development qualification

`mod-forge/src/apply.ts` now owns artifact selection, preflight, preview order,
approval policy, post-approval checks, Git application, and effect reporting.
The CLI's `handleApplyPatch` body and export are removed. The host supplies only
an invocation-scoped UI port and immutable artifact snapshot. It contains no
patch-selection algorithm or Git effect. This retires the whole-workflow
**A13-APPLY-HOST** callback, not the remaining backend compatibility reexports.

The generated path and legacy-shaped `/apply` dispatch both select the physical
Forge contribution. Legacy-shaped dispatch uses the existing job manager and a
stable catalog public ID, not a hardcoded ordinal. Only Forge's Apply execution
gets the UI scope. Missing, disabled, stale, cancelled, borrowed, and expired
contexts cannot use that scope. A real generation change that disables Forge
during approval prevents the subsequent write.

### Verified behavior corrections

- Approval now accepts only `y` or `yes`. Empty input no longer approves. This
  fixes an actual unsafe interaction: the UI also resolves dismissed questions
  with an empty answer when a permission request has priority.
- Abort settles the approval promise and clears only that question. A late
  answer cannot revive the invocation or dismiss another question.
- The workflow checks Git state again after approval. Git probe failure is
  unknown, not clean, and cannot be bypassed with `--force`.
- An applied patch remains reported as applied if a final UI notification fails.
- Preview contains the entire captured patch. Both transcript renderers use
  literal text, not model-output cleaning, narration folding, or Markdown.
  Terminal control bytes and bidi formatting are displayed as escapes. Long
  lines wrap instead of truncating. The copy buffer retains the original bytes.

The `PatchApplicationHostServices.apply` bridge becomes `open` plus narrow
interaction methods. This is a candidate public-type change and requires the
final API/release compatibility gate. It is not a claim that any published API
may change without version qualification. Removed CLI handler exports were
private implementation paths, not the package's declared public exports.

### Independent review adjudication

Claude reviewed the complete workflow through isolated candidate Agon.
[Initial input](evidence/modular-agon-claude-apply-review-input.json),
[initial review](evidence/modular-agon-claude-apply-review.json),
[follow-up input](evidence/modular-agon-claude-apply-followup-input.json), and
[follow-up review](evidence/modular-agon-claude-apply-followup.json) preserve
the exact source supplied and the raw findings with content hashes. Its
first review prompted the corrections above. Further source checks:

- The service builder already grants `patchApplication` only to Forge. The
  claim that every first-party mod receives it was false; execution scope is
  now narrower as defense in depth.
- Core and Forge resolve the same support backend. Package export identity
  tests cover this; there is no duplicated implementation.
- The physical dispatcher captures `resolveWorkingDir()` before opening the
  host. Tests pin the invocation workspace rather than relying on runner cwd.
- Ctrl-C already refused UI questions. Programmatic abort needed the separate
  owned cancellation repair described above.
- Explicit external patch paths remain supported. An opaque undo token is not
  an operator-selected artifact path; its traversal defect remains separate.
- A concurrent writer can still alter a repository outside Agon. The workflow
  approves a captured patch, rechecks dirty state, and lets Git validate its
  application. It does not claim a repository-wide transaction or isolation
  from unrelated Git processes. Concurrent Apply behavior remains in backend
  pressure testing; no untested global lock guarantee is asserted.

The follow-up found two more confirmed defects and one UI omission:

- Git invoked below the repository root can silently skip repository-relative
  patch paths. Preflight now resolves and pins the root, validates there, names
  that actual target in the approval prompt, and applies there. Artifact paths
  still resolve relative to the original invocation directory. The real-Git
  test asserts resulting file bytes, not merely exit status.
- Dirty `--force` previously bypassed dry-run validation. It now bypasses only
  dirty-tree refusal; malformed or non-patch data still fails Git validation
  before approval. Empty manifest patches are rejected. The backend's separate
  empty-diff no-op API remains compatible; the interactive workflow cannot use
  it to claim an empty application succeeded.
- Status/error metadata and the target prompt now use the same control-character
  escaper as the preview. Unicode default-ignorable and format characters are
  visible, including invisible filename characters. Raw patch bytes remain
  unchanged in the application and copy-buffer paths.
- Two Apply sessions sharing a terminal dispatcher cannot compete for its one
  question slot. The second fails visibly before preview; `finally` releases
  the reservation. Separate host contexts remain isolated. This is UI ownership,
  not a cross-process repository lock.

The remaining normalization concern was checked against the five-line function
and a 519-input idempotence corpus. The question cancellation test also traverses
the real question handler and verifies that it preserves the callback identity.

The [second follow-up](evidence/modular-agon-claude-apply-followup2.json), with
[exact input](evidence/modular-agon-claude-apply-followup2-input.json), prompted a
sink-by-sink inspection of literal events. The flat `attach` renderer needed
escaping; it now handles both raw patch content and engine metadata safely.
Physical-contribution stderr also escapes terminal controls before display.
The two TUI renderers were already covered. `/raw` reads only the narration
fold store, which literal events bypass; JSON persistence and the copy buffer
intentionally retain raw data rather than executing it.

The dispatcher identity concern was confirmed: React's callback depends on
mode and chat session. The UI reservation now covers the process question slot,
not a replaceable callback. A negative test uses different callbacks for the two
competing sessions. Backslashes and non-ASCII spaces are also escaped so literal
escape-looking text and invisible controls cannot have identical previews.

Additional inherited backend work remains explicit, not waived:

- Reject invalid UTF-8 patch artifacts rather than silently replacing bytes.
- Resolve relative manifest patch references deterministically; current reads
  depend on process cwd while first-party generated manifests use absolute paths.
- Pressure-test status output beyond the default child-process buffer and add a
  bounded, useful large-repository probe policy. No production source currently
  calls `isTreeDirty` outside its definition/reexports; external callers still
  need the fail-closed behavior documented.

The unprefixed `apply` parser was unchanged by this extraction. Natural aliases
are part of existing routing behavior; this finding does not authorize silently
removing that command alias. Full-code imports are not a security sandbox: the
Forge-only claim applies to the injected approval UI, not arbitrary filesystem
access by trusted executable code.

The [display/lifetime review](evidence/modular-agon-claude-apply-display.json)
([input](evidence/modular-agon-claude-apply-display-input.json)) confirmed the
escaper, wrapping core, scope checks, and reservation behavior. Its concrete
follow-ups were repaired: literal patches no longer generate model timing
footers containing raw engine metadata; narrow transcript labels wrap; and
scope exit cancels an abandoned owned question. Tests failed before each fix.
The actual Apply contribution is not a generator, so the suggested iterator
lease path is not reachable for Apply. The captured React dispatch retains the
same live state setters; `question-cancel` matches the owned resolver rather
than callback identity. Ordinary model-output escaping and cross-mode question
arbitration remain separate UI audit dimensions, not claims of this patch.

The [final display review](evidence/modular-agon-claude-apply-display-review-final.json)
([input](evidence/modular-agon-claude-apply-display-review-final-input.json)) found
that plain patch lines could resemble host messages. Every live and committed
patch row now has a `| ` gutter, including continuation and empty rows. Wrapping
reserves its width. Escape sequences remain atomic whenever one fits a row;
narrower rows retain every character. Combining marks, undefined/private glyphs,
surrogates, and Braille blank now use explicit escapes. This deliberately trades
some non-Latin readability for an unambiguous approval display; application and
copy-buffer bytes are unchanged. Four tests failed before these changes.

The [bounded repair review](evidence/modular-agon-claude-apply-boundary-review.json)
([input](evidence/modular-agon-claude-apply-boundary-review-input.json)) verified
the gutter and atomic-escape behavior by source inspection. Adjudications:

- Flat attach replay uses `oneLine`, so embedded patch newlines cannot create
  unmarked host-prompt rows. It remains a flattened replay, not the approval UI.
- Actual live/layout width comes from `contentWidth`, with a 40-column minimum.
  A hypothetical width below four is not an active preview execution path. The
  existing terminal-wide minimum remains a general UI limitation, not a new
  claim of sub-four-column terminal support.
- `AbortSignal.any` is supported by the declared Node >=22 floor.
- Unknown question resolvers are covered by the existing cancellation test,
  including a newer question and null state. The reviewer lacked that excerpt.
- The test's ordinal selects the frozen registered contribution. Production
  dispatch selects its stable public catalog ID. A catalog reorder must update
  its parity fixtures; no runtime ordinal was introduced.
- Trailing empty patch rows preserve line boundaries deliberately.
- Unicode table differences can alter display escaping, not applied bytes.
- Large-preview allocation concerns remain unmeasured, not proven defects or
  evidence of passing the final performance budget.

An additional negative control caught an abandoned public confirmation promise:
observing only the inner UI promise did not prevent the outer async rejection.
The public promise now has an observer while still rejecting for awaiting
callers. The test failed with an actual unhandled rejection before the repair.

### A15 recurrence during qualification

`apply-final-tests.log` reproduced the unchanged daemon-survival ping failure:
6,517 tests passed, one failed, six skipped. No production daemon source was
changed by Apply. This failure remains **open**; a later green run cannot erase
it or qualify the whole release by itself.

The old diagnostic checkout passed once again. A disposable checkout based on
`34e094d3`, with current package/test changes copied through explicit patches,
also passed with server/client diagnostics and then with client-only diagnostics
(6,520 tests, six skips each). It used copied build artifacts and the candidate's
dependency tree, not a clean-install release subject. Paths/logs:
`/tmp/agon-a15-recurrence-WKf7nY`. The original diagnostic instrumentation remains
outside this implementation branch. No blind retry or longer ping timeout was
added to the oracle.

A subsequent focused daemon run overlapped a CLI rebuild and failed at startup,
not at the ping. That run is contaminated and is not evidence for A15's cause.
Build/test serialization is required. The test client now records connection,
error/close/timeout reason, bytes, partial frame and elapsed time in the original
ping assertion. A refused-socket negative control verifies those diagnostics.

The subsequent serialized run, with that client instrumentation and no daemon
runtime changes, passed 6,527 tests with six existing skips. It improves evidence
for the current source; it does not close the intermittent A15 failure.

### Apply increment verification

The increment passes typecheck, lint, re-export guards, generated-package drift,
49-package packing, supply-chain self-tests, and 72 isolated npx checks. The
packed release set is 1,860,751 bytes. Final CLI rebuilding followed the full
workspace build; no build overlapped the accepted full-suite run. Review
findings, red-before-fix tests, the failed A15 run, and the contaminated startup
diagnostic are retained separately in the development receipt. This is not a
clean-checkout release receipt or permission to install.

Red-before-fix tests cover legacy delegation, empty approval, stale dirty state,
lost effect receipts, truncated preview, unclosed abort prompts, Markdown data
loss, duplicate-preview suppression, and render-cache aliasing. The authority
mutation control removed the post-approval lease check and made tests fail.
Component evidence is not whole-release acceptance. Plan, Brainstorm, backend
hardening, adapter retirement, and clean-checkout release qualification remain.
