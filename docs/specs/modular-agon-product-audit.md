# Installed-product audit and repair ledger

Audit subject: `667317911ce04bae2dbe70946fe7cff937e17ca7` (2026-09-05).
Disposition: **not release-ready**. The earlier 33-gate pressure run did not
exercise these installed-user contracts. Its passing executions are not a
whole-product compatibility verdict. No active installation may be promoted
on the strength of that receipt.

## Findings and clean repair plan

| ID | Finding | Repair boundary and required regression | Status |
| --- | --- | --- | --- |
| A01 | Disabling Think commits a lock rejected on the next boot; re-enable cannot restore filtered records | Build selection from a retained, identity-bound installed inventory, not the previous active subset. Validate lock integrity and resolved closure before committing. Exercise disable → fresh boot → enable → fresh boot, dependencies, stale approval, missing inventory and rollback. | Repaired; 36-mod fresh-bootstrap matrix and installed lifecycle verified |
| A02 | Successful lifecycle mutation subsequently fails the lazy parent generation check | Check authority before dispatch, not after a child has deliberately changed generation. Keep stale-client rejection for new invocations. Exercise the real nested CLI. | Repaired; nested CLI and stale-client regressions verified |
| A03 | Packaged MCP searches nonexistent engine asset paths | Use the shared engine-runtime asset resolver, just as CLI does; test a relocated packaged MCP without repository fallback or credentials. | Repaired; shared resolver test and guarded packaged MCP probe verified |
| A04 | TUI Think emits `input`/numeric flags while its handler expects `problem`/string flags | Normalize each surface into the same validated domain request; test parser → schema → handler, including flags and malformed input. | Repaired; legacy intent shape retained, parser/schema/handler test verified |
| A05 | TUI plan-task is dispatched to existing-plan lookup | Restore task planning/resume semantics through an explicit modular contract, not an unowned legacy bypass. Test new task, inspect, resume, approval and persistence. | Open |
| A06 | Brainstorm silently drops synthesis, calibration, dedup and retry behavior | Extract the actual workflow behind injected capabilities. Compare raw results and engine-call sequences with the frozen legacy oracle; do not substitute a simplified algorithm or maintain two authoritative implementations. | Open |
| A07 | Linux CI lint exhausts V8 memory | Measure typed lint scope and partition work without omitting files/rules. Prove complete coverage and run within CI resources. | Repaired locally; 4 GiB lint passes; Linux CI rerun pending |
| A08 | External folder-mod engine capability delegates to a throwing compatibility stub | Provide a real host engine capability to both CLI and MCP while preserving trust/grant checks. Test granted dispatch, refusal/revocation and error propagation with fixture engines. | Repaired; real worker dispatch and live grant revocation verified |
| A09 | First-party semantic receipts return hashes without persisted records; logging is a no-op | Use durable owner-attributed, redacted receipt/log storage; test retrieval, uniqueness, redaction and write failure. Separate these receipts from run artifacts. | Repaired; shared durable/redacted evidence writer verified |
| A10 | Claimed mutation coverage is not an actual implementation-mutation score | Inject targeted behavioral mutants and require discriminating tests to kill them. Label negative controls separately. | False score claim corrected; actual implementation mutation testing still open |
| A11 | Legacy algorithms remain beside replacement mod implementations | Reconcile every runtime owner and route with the extraction ledger; retain only explicitly owned compatibility adapters with removal tests. | Open |

## Reproduction and positive evidence

### Active TUI exit: owned-process safeguard (2026-09-16)

A real PTY probe started a long-running fixture engine and pressed Ctrl+C
twice. The TUI exited 0 without driver intervention, but its engine remained
alive with no stop receipt. The probe cleaned up that exact fixture PID.
Separate buffered/streaming host-exit regressions reproduced this before repair.

The shared process runners now register their spawned process groups in one
private ownership set. One lazy synchronous `exit` handler terminates groups
still owned when the host exits. Normal child closure removes ownership; when
the set empties, the handler is removed. Concurrent-run tests verify that twelve
runs share one handler and leave no handler afterward. No public Mod API or
personal/global state is added.

The packed PTY verifier now has a separate active-exit case: wait for engine
readiness, double-Ctrl+C, require an unforced app exit 0 and disappearance of
the recorded engine PID. This is emergency SIGKILL cleanup, **not graceful
shutdown or durable run/session finalization**. A host killed by SIGKILL cannot
run this handler; OS-signal termination paths, providers outside these runners,
escaped process groups, persisted interrupted-run recovery and native platform
coverage remain open. No live provider was used.

Full-suite verification exposed a fixture publication race: `existsSync`
could observe a newly opened, still-empty readiness file; converting its empty
contents to a number yielded PID 0. Positive-PID assertions reproduced this
before correction. Descendant and host-exit fixtures now publish readiness by
atomic rename; the installed engine fixture publishes both start/stop receipts
the same way. The process-disappearance oracle is retained, and PID 0 is
explicitly rejected. No timeout was widened to hide this failure.

Local verification after repair: build, typecheck, lint, re-export guard,
6,193 tests (five existing skips), package/SBOM checks and all 72 installed
checks pass. Active/global Agon and personal provider state remain untouched.
This is development evidence, not independent release qualification.

### Cancelled process-group survivor repair (2026-09-16)

The next shutdown audit found a lower-level leak in both buffered and streaming
process runners. A group leader could exit on SIGTERM while its child ignored
SIGTERM and had independent stdio. The leader's `close` handler cleared the
SIGKILL escalation timer, leaving that child alive. Two real-process tests
reproduced the leak before the repair; test cleanup explicitly killed the
fixture group.

The shared engine-runtime package now finishes process-group termination when
the cancelled/timed-out leader closes, before discarding escalation timers.
Normal exits do not take this path. Unexpected termination errors are logged;
an already absent group is expected. Four regressions cover buffered/streaming
dispatch × cancellation/timeout with a SIGTERM-resistant descendant and require
ESRCH for its recorded PID after cleanup. These fixtures use temporary paths,
bounded lifetimes and no provider code.

The same fixture revealed a second defect: a parent's SIGTERM handler exiting
0 overrode the runner's cancellation/timeout result. Four additional result
assertions failed before correcting the precedence. Both runners now return
130 for cancellation and 124 for timeout even when the parent exits cleanly;
ordinary exits still preserve the child's status.

This proves teardown of descendants that remain in the runner's POSIX process
group on this Mac. It does not claim containment of children that create a new
session/process group, nor qualify quitting the entire TUI during active work.
That broader shutdown check remains open; this leak was repaired first.

Local gates after both fixes: build, typecheck, lint, re-export guard, 6,189
tests (five existing skips), regenerated package/SBOM checks and all 71
installed-candidate checks pass. These are development checks, not independent
native-platform release qualification.

### Installed Escape cancellation and recovery (2026-09-16)

The installed Brainstorm PTY scenario now covers failure → running-engine
cancellation → two successful commands → idle keyboard exit. Before pressing
Escape, the driver waits for a readiness file written by the fixture engine
after installing signal handlers. The engine otherwise waits thirty seconds
and fails; its configured adapter timeout is sixty seconds. Cancellation must
produce a signal receipt within three seconds, so ordinary completion or
engine timeout cannot satisfy the gate.

The verifier checks matching started/stopped PIDs, SIGTERM/SIGINT receipt,
process absence, exactly seven draft/expansion invocations, four persisted
run outcomes, and an explicit `aborted` summary on the cancelled run. The
local installed probe received SIGTERM and passed subsequent command/exit
checks. No production runtime change was needed for this path.

Two test-first PTY-driver regressions prove that missing readiness fails and
input is not sent before readiness. Both failed before `waitForFile` support.
The previous four exit regressions remain in place. Public npm dependencies
were rehydrated into temporary storage with lifecycle scripts disabled after
the earlier temporary cache disappeared; no personal npm configuration or
active/global Agon was used.

This closes the narrow fixture-engine Escape path, not all A06 cancellation:
live providers, descendant process trees, cancellation during other phases,
shutdown during active work, session flush completeness, managed profiles,
native platform coverage and independent review remain unqualified.

Local development gates pass: build, typecheck, lint, re-export guard,
6,185 repository tests (five existing skips), and all 71 freshly packed
installation checks. This is not an independent release-readiness receipt.

### Installed idle keyboard exit (2026-09-15)

The installed PTY check now sends two Ctrl+C key bytes after its three
completed Brainstorm runs and requires the app to exit with status 0 within
five seconds, without any driver cleanup signal. `pty-drive.py` exposes an
explicit `waitForExit` step: nonzero child exits and signal termination remain
failures; exceeding the deadline returns 124 even if forced cleanup could
otherwise exit successfully. Existing performance-probe cleanup is unchanged.

Four subprocess regression tests cover normal exit, exit 7, SIGTERM, and a
hung child whose SIGINT handler would exit 0. The original driver failed all
three initial normal/crash/timeout assertions before implementation. The
installed 71-check qualification passes with the stronger exit requirement.

This supersedes the forced-cleanup limitation of the PTY case below **only
for idle keyboard exit**. It does not establish shutdown during active work,
provider-process termination, descendant cleanup, session flush completeness,
or cross-platform terminal parity. A06 remains open on those dimensions.

Development gates: full build, typecheck, lint, re-export guard, four PTY
driver tests, full repository suite and the 71 installed checks pass. These
are local development observations, not independent release qualification.

### Real slash-command entry point and installed PTY coverage (2026-09-15)

A real terminal probe exposed a gap missed by the component and Cesar-route
checks: `/brainstorm` executed its physical TUI contribution through the
generic renderer, printing raw result JSON rather than Brainstorm progress,
drafts and the winner response. The existing presenter was not wired into this
entry point. This supersedes any inference that the earlier component checks
qualified normal slash-command rendering.

`blocks/brainstorm-session.ts` now owns the shared session effects, context
enrichment, presentation and cleanup previously embedded in the Cesar route.
Cesar still executes its Cesar contribution; the TUI still executes its
selected TUI contribution. The TUI bridge selects this behavior using the
registry owner's `agon.brainstorm` identity, not a command-name match. No
second workflow executor or cross-surface availability bypass was introduced.
Test-first cases cover readable results, session-selected engines/context,
cancellation of a late success, and an external command with the same name
remaining on the generic path. Existing Cesar/session recovery checks pass.

The new `verify-packed-brainstorm-tui.mjs` runs the installed npm bin on a real
120x40 PTY, sends a failing slash command followed by two successful commands,
and requires draft rendering, winner expansion, exactly six fixture-engine
calls and corresponding failed/successful persisted run statuses. Driver exit
alone is not accepted. The existing Python PTY driver
forcibly stops its child during cleanup, so this is **not** graceful-exit or
keyboard-cancellation qualification. Python 3 with POSIX PTY support is required.

The effect guard initially prevented UI startup by refusing Yoga's embedded
WASM `data:` fetch. It now decodes bounded inline WASM bytes locally, without
delegating to network fetch. Network requests, other data types, arbitrary
Node commands, shells and provider launches remain blocked. This remains a
diagnostic guard, not a security sandbox. All homes and engine definitions are
temporary fixtures; no active/global installation or personal state is used.

**A06 remains open:** actual provider termination, keyboard cancellation,
graceful shutdown, managed-profile interactive activation, broader terminal
matrix and independent review are not closed by this positive PTY case.

Development verification passes: the pre-refactor full/type/lint baseline,
17 focused slash/Cesar/recovery checks after extraction, full build, typecheck,
lint, re-export guard, 6,179 tests with five existing skips across 524 files,
release-set/SBOM checks and 71 npx checks including the installed PTY case.
An initial installed probe retained an empty `CI` key and captured only part
of the terminal output; the interactive child now removes that key, as the
successful diagnostic probe did. The output assertion was retained unchanged.
Full-suite log SHA-256:
`027d7d9fd63c136384f79214b6196a316ad149ad9fe3223c5ee2107c986748d9`.
Packed qualification log SHA-256:
`726d41d170314ff908fd186e1b9d7d621ea2460075bad3e8837725d7647a2332`.
Temporary logs are development diagnostics, not immutable independent release
receipts. The new shared session helper remains CLI-owned A06 session machinery;
this does not close the KL-011 migration boundary.

### Brainstorm validation and interactive recovery (2026-09-15)

The physical mod now rejects unsupported styles before opening host
capabilities, selecting engines or creating a run. The accepted values remain
`divergent` and `grounded`, with `divergent` as the omitted-value default,
matching the legacy CLI's supported styles. Empty, null and non-string styles
are rejected, not silently replaced. Rendering and execution use the same
validated value. No schema, public API or dependency boundary was added.

Four test-first cases reproduced engine work for malformed styles; all now
stop before host/run effects. Both valid styles retain successful execution.
The packed CLI fixture also checks that an unknown style emits the actionable
validation error, no stdout and no run directory—even with an invalid engine
ID, so an engine failure cannot masquerade as successful validation.

`modular-brainstorm-interactive-recovery.test.ts` exercises the actual Cesar
route and presenter together, replacing only registry execution and session
recording effects. It verifies failure → cleared progress → successful next
invocation, and cancellation → rejected late success → ignored old progress
events → successful next invocation. Timers are drained and stale answers are
not rendered or recorded as successes. These paths already worked; this adds
behavioral coverage rather than changing cancellation machinery.

**A06 remains open.** This does not qualify keyboard-driven cancellation,
physical provider process termination, a full installed interactive session,
managed-profile activation or independent review. Session recording is mocked
in the recovery checks; no claim of new persistence qualification is made.
Active/global Agon and personal state remain untouched.

Development gates pass: 58 focused mod/oracle/MCP checks, 24 presenter/route
checks, the full suite (6,174 passing tests, five existing skips, 523 files),
build, typecheck, lint, re-export guard, release-set packing, supply-chain
check/self-test and all 70 npx checks. Release-channel integrity, release-set
contents and SBOM were refreshed for the changed package bytes. Full-suite
log SHA-256:
`a05d5cc9b1c54e8cc99d199bc80beddc1142127f4af11685938931267a5d498e`.
Temporary logs are development diagnostics, not immutable independent release
acceptance receipts.

### Brainstorm terminal draft metrics (2026-09-15)

The modular terminal presenter now displays each bid's confidence separately
from its quality score. Previously its draft header retained only the score,
even though the workflow result includes calibrated confidence. The confidence
label is a model-derived, history-adjusted value, not a measured probability of
correctness. This changes presentation only; ranking and calibration are not
recomputed by the UI. Historical results without a finite confidence omit that
label instead of inventing a value, and zero remains visible.

Two test-first cases reproduced missing confidence in the actual transcript-row
projection. Additional tests pass the presenter's winner and non-winner draft
events through `renderBlockOwnRows`, `TranscriptRowView` and Ink's existing
pseudo-TTY frame capture at 40 and 100 columns. Both metrics and rationale text
survive terminal wrapping. Existing progress, retry, finalization, fallback and
session-route cases remain in the focused gate. The unused legacy `BidGroup`
export is not the active transcript renderer and was not modified.

This is a bounded component-render qualification, not a full interactive
session or keyboard/resize/cancellation acceptance receipt. **A06 remains
open**, including installed managed-profile activation, full interactive
session qualification and independent review. No live engine, login, active
installation or personal state is used.

Development verification: the 22 focused presenter/session-route checks pass;
the full suite passes 6,166 tests with five existing skips across 522 files.
Build, typecheck, lint and re-export checks pass. The release-set and SBOM
were regenerated for the changed CLI bundle. Full-suite log SHA-256:
`e7f438616f0ef3d45916ad1b6da1a8d7b8beac957cfaf4f98db2d441153d22dc`.
Logs in `/tmp/agon-brainstorm-verify-7YFkOIQh` remain development diagnostics,
not independent immutable release acceptance receipts.

### Installed Brainstorm command qualification (2026-09-15)

`scripts/spec/verify-packed-brainstorm.mjs` now runs as part of the existing
`verify-modular-npx.mjs` gate, after all release tarballs are installed offline
into the disposable npm prefix. It invokes that prefix's real `.bin/agon` via
Node, exercising argument parsing, the bundled modular registry, CLI host,
engine registry, adapter subprocess dispatch, workflow and persisted status.
No source-module replacement or mocked host is used. Only the engine is a
deterministic local protocol fixture registered in a fresh temporary Agon home.

Cases cover human output, `--quiet`, `AGON_QUIET=1`, failed-seat retry and a
deliberately buffered-output negative control. The fixture cannot finish its
draft until the parent observes the run path on stdout. Buffering stdout until
exit causes both attempts to fail with the specific missing-stream diagnostic;
normal output reaches synthesis and records a successful engine status. Checks
also distinguish quality from confidence, prohibit duplicate run announcements,
require exactly two quiet lines, and verify draft/expansion dispatch counts.

A test-only preload refuses subprocesses except the exact local fixture via
the running Node executable, and refuses fetch. Separate guard tests cover
allowed dispatch and rejected arbitrary Node code, shell execution and fetch.
This is an effect guard, not a security sandbox. Homes and modular-host roots
are isolated; no provider, credential, browser login or active installation is
used. The first negative-control harness run incorrectly assumed a separate
stderr artifact existed; the assertion now reads the actual persisted engine
detail in `status.json` instead. No production behavior was changed.

This closes the positive **installed npm-bin/parser** gap for these cases,
not every launcher variant. The durable minimal-profile launcher still has
its existing separate lifecycle checks; enabling Brainstorm through that
managed profile, live-provider behavior, cancellation/input edge cases, exact
terminal styling, interactive UI and independent review remain unqualified
here. **A06 remains open.** Temporary development logs are not independent,
immutable release acceptance receipts.

Development gates pass: full build, typecheck, lint, re-export guard, release-set
packing, supply-chain check/self-test, and all 70 npx qualification checks.
The full suite passes 6,161 tests with five existing skips across 522 files.
Full-suite log SHA-256:
`adf3befc3f38fd4a9cb177c74cd6c43b54d59d2cd233d57e4bec990d0ecf55eb`.
The final packed-command run occurred after the build completed; no tarball
or SBOM drift was introduced by this test-only change.

### Brainstorm CLI streaming repair (2026-09-15)

The existing bundled Brainstorm host interface now accepts an optional
`writeCliOutput` sink. Only the CLI host for `agon.brainstorm` supplies stdout;
the pipeline host does not gain it, and the common Mod API is unchanged.
Only the CLI contribution consumes the sink. A host without it retains buffered
final output, preserving the prior embedded invocation behavior.

The run path is emitted after run creation and before workflow preflight.
Human mode emits the question/roster/style header and each completed seat's
attempt count or failure detail. Quiet mode emits the bare path without those
lines. Final success/failure output emits the summary without repeating the
already announced path. Streaming is disabled as soon as workflow rejection is
observed and on normal completion, preventing late seat callbacks from printing
after the command ends. Raw workflow observer semantics remain unchanged.

Test-first evidence covers early ordering, human/quiet behavior, failure-path
deduplication, machine-output isolation, late completions, and CLI host wiring.
The late-callback regression initially observed a third output chunk after a
failed run had already returned; it now remains at two. The reusable public
entrypoint fixture also covers buffered and streaming human/quiet output.

**A06 remains open:** actual installed launcher/parser and terminal/UI visual
qualification, exact legacy styling, and independent review remain outstanding.
The sink uses the CLI's existing synchronous stdout-write convention; this is
not a new generic backpressure or asynchronous streaming API. No active/global
installation, personal state or provider login is used by these checks.

Development checks: full package build followed by a CLI rebuild after the
host-construction cleanup; typecheck, lint and re-export guard pass. The complete
suite passes 6,156 tests with five existing skips across 521 files. Full-suite
log SHA-256: `84528d289fb8dd3ab16436d6a73ad14456e6519bd3552bc5b3fbf626704f498b`.
Final CLI build log SHA-256:
`a4a732f110225051d76193c8a3d837a32c32b3a4100e1884ff0fb1a7b6c86375`.
Temporary logs under `/tmp/agon-brainstorm-verify-7YFkOIQh` are development
diagnostics, not independent immutable acceptance receipts. The initial suite
caught an outdated exact host-shape assertion; it now explicitly allows the
writer on CLI Brainstorm only, retaining exact shapes for MCP and pipeline.

### Brainstorm CLI final-output repair (2026-09-15)

The CLI contribution now renders human-readable final bids (quality and
confidence separately), winner response, degraded-panel/dedup/synthesis warnings,
`AGON_RUN` and `AGON_SUMMARY`. Quiet CLI output is the plain run directory plus
the summary, including failed runs. `AGON_QUIET=1` applies to CLI rendering only;
the mod does not mutate the environment. Machine/TUI/Cesar/MCP invocation paths
retain their previous structured result and stdout behavior.

Tests first exposed JSON as human output, answer text as quiet output, and a
missing failure summary. Fixtures now assert exact quiet lines, human headings,
structured-result preservation and environment isolation. Existing outcome tests
read the structured `result` instead of parsing human CLI stdout.

`scripts/spec/fixtures/brainstorm-cli-output.mjs` accepts a public built/installed
package entrypoint URL and checks human/quiet output with injected fixture seats.
It passed against `packages/mod-brainstorm/dist/index.js` with the provider/login
guard enabled. This is a built public-entrypoint check, not a complete installed
launcher/parser test. Reproduce with `node scripts/spec/fixtures/brainstorm-cli-output.mjs`
followed by the absolute `file:` URL of the candidate package's `dist/index.js`.

**A06 remains open.** This is final-output parity, not byte-identical legacy
color/table layout. Run-path announcements and seat streaming still arrive only
at completion on this generated path, not at legacy timing. Installed positive
terminal/UI verification and independent qualification remain outstanding. Quiet
mode does not promise silent stderr: workflow warnings retain their existing
diagnostic behavior. No active/global installation or personal state is changed.

Development verification: full build, typecheck, lint and re-export guard pass;
6,150 tests pass with five existing skips across 520 files. Full-suite log SHA-256:
`80a9907c4b40936f8cf43d91533f37b0ab2ee8c864323428b7da1599aaf7ce1d`.
Build log SHA-256:
`e07525d95bd5f1d0c88d6c0958299957519099753e340ebad5c7931269b37b98`.
Logs under `/tmp/agon-brainstorm-verify-7YFkOIQh` are temporary development
diagnostics, not independent immutable acceptance receipts.

### Brainstorm scoreboard repair (2026-09-13)

The invocation-local presenter now reuses the existing scoreboard renderer.
The Cesar route supplies its selected engine roster before execution, keeping
preflight-skipped/nonresponding engines visible. Seat events update the board;
successful completion finalizes bid scores and marks missing bids `no response`,
matching the legacy finalization policy. Workflow failure preserves known seat
errors and marks remaining entries `brainstorm aborted before a usable draft`.
That inherited wording also covers cancellation; it is not a separate claim
that no draft existed before a later synthesis failure.

Completion/failure stops the polling timer and seals presentation against late
events or repeated terminal rendering. Finally-disposal still clears progress.
The board is local to the invocation and performs no persistence or execution.
Two scoreboard assertions and two route-wiring assertions failed before the
repair. Renderer comparisons cover successful/degraded and failed boards,
including a requested engine with no events; existing tests cover retries,
concurrent presenter state and disposal. This is output/event evidence, **not**
installed terminal screenshot or concurrent arena-ownership qualification.

**A06 remains open:** CLI human/quiet formatting, installed positive terminal/UI
behavior and independent qualification remain. The shared renderer's ANSI and
icon behavior is unchanged; this repair does not claim a new accessibility or
non-color fallback qualification.

The first full-suite attempt encountered the already tracked daemon-survival
`pong` failure while package rebuilding was still running. The log is retained
as `scoreboard-full-concurrent-build.log` under the temporary verification
directory (SHA-256 `4681846d134074c4de72ade7b0092ed70a298c21233ed7a66a0799edb024ff90`).
Concurrent build interference is plausible, not established; this attempt is
not clean qualification and does not close the daemon finding.

After the full build finished, the complete suite passed: 6,146 tests, five
existing skips, 520 files. Full build, typecheck, lint, re-export guard,
release-set and SBOM self-check also pass. Full-suite log SHA-256:
`216e4bd40467a395923d1165b028c0b406d719dbd5345f93703e22e047e2cc81`.
Build log SHA-256:
`acb66fcbdc63ee60db62390f6b2243ffd4b3332ea33916b61dd9ff3da2bdc5e8`.
Logs are temporary development diagnostics under
`/tmp/agon-brainstorm-verify-7YFkOIQh`, not independent immutable receipts.
No active/global installation, personal state or live provider was used.

### Brainstorm project-context repair and clean-tree test correction (2026-09-13)

The physical Cesar Brainstorm route now reuses `scanProjectContext` with the
session's `projectContext` and `contextFormat` settings. Scanning and execution
share one captured working directory. The scan happens after input validation
and before session recording; cancellation prevents scanning. Explicit context,
including an empty string, bypasses scanning. Non-string context is rejected.
This restores the legacy context source without moving workflow logic into the
CLI or introducing a second scanner. Scanner policy and truncation are unchanged.

Six route cases cover enrichment, explicit/empty context, malformed context,
cancellation and scanner failure. Three assertions failed before implementation.
A separate physical-mod characterization verifies that supplied context reaches
both real draft prompts. Existing scanner tests cover the filesystem behavior;
the route tests inject scanning and execution, not live providers.

The initial clean-worktree baseline at `34418eb6` was red: MCP Review's generic
failure-conversion test used the ambient uncommitted diff. A clean checkout
correctly returned no-diff success before reaching the expected error. The test
now supplies a fixed nonempty review target, while a separate empty-target test
requires successful empty results and no engine dispatch. No runtime behavior or
rejection oracle was weakened. Earlier dirty-tree green runs do not establish
clean-checkout qualification for that test.

**A06 remains open:** scoreboard behavior, CLI human/quiet formatting, installed
positive terminal/visual behavior and independent qualification remain. This
repair covers the Cesar session path, not automatic scanning on every surface.

Development verification: 6,144 tests pass, five existing skips, 520 files;
full build, typecheck, lint and re-export guard pass. Build log SHA-256:
`083a1b24b3d6a3d29df16bf380451c12c30a235294cf84cc17e2b0182482091c`.
Full-suite log SHA-256:
`a08d70dddabb92bb3c0548a3211f9b47acc99eb71ccbd548ffe478dc62651fb7`.
Logs remain temporary development diagnostics under
`/tmp/agon-brainstorm-verify-7YFkOIQh`, not independent immutable receipts.
No active/global installation, personal state or live provider was used.

### Brainstorm session-effect repair (2026-09-11)

The physical Cesar Brainstorm route now records legacy-shaped chat messages,
tracker entries, in-memory session results, pre/post checkpoints and terminal
telemetry through `blocks/brainstorm-session-record.ts`. This is temporary
**A06-SESSION-EFFECTS (KL-011)**, owned by CLI presentation/session integration;
it must be removed when these effects are injected through the public host
boundary. The mod remains the only execution owner. The session-effect and
route tests guard this adapter's contract for its eventual removal.

The default roster comes from the current session, with the existing default
orchestration filter. An explicit roster is retained. The same roster goes to
the physical mod and the session recorder. Invocation checkpoint IDs now use
UUIDs to avoid timestamp collisions. No new persistence format is introduced.
Existing checkpoint writes remain best-effort, and the ordered history writes
are **not** an atomic transaction. The session-result store remains in-memory.

Twelve isolated-effect regressions cover exact legacy payloads, idempotent
terminal recording, failure versus cancellation, late-result rejection, failed
history writes, summary-format failure after recording, route wiring, explicit
engine selection, invalid input, and unrelated-workflow isolation. Before the
repair, four recording assertions and two route-wiring assertions failed.
Execution failures retain their original error if failure telemetry also fails.

**A06 remains open:** project-context enrichment, scoreboard behavior, CLI
human/quiet formatting, installed positive terminal/visual behavior and
independent qualification are still outstanding. This is development evidence,
not a release receipt or a claim that all Brainstorm surfaces are complete.

Development verification: 6,136 tests pass, five existing skips, 520 files;
full build, typecheck, lint, re-export guard, release-set, 69 isolated npm/npx
checks and SBOM self-check pass. Temporary diagnostic logs are under
`/tmp/agon-brainstorm-verify-7YFkOIQh` (not independent immutable receipts).
Full-suite SHA-256: `2067e76e2efe1c56705e010023f31aef21895ee21d5c87897896b305d6df9399`.
Build SHA-256: `82ea050964408e554807ac20785eb6b959f3abdd0334513c2ca4ee4e743d4014`.
No live provider, active/global installation or personal state was used.

### Brainstorm progress and run-record repair (2026-09-11)

The physical Cesar route now carries an invocation-local, mod-owned event
observer into the extracted workflow. The common Mod API is unchanged. The ten
frozen workflow comparisons now include the **raw event sequence**, rather than
omitting UI callbacks from the comparison. Failed run records preserve per-seat
diagnostics; summaries preserve the degraded-panel banner; absent labels are
omitted instead of written as null, matching serialized legacy status behavior.

`packages/cli/src/blocks/brainstorm-presentation.ts` owns presentation only:
seat progress, elapsed ticks, retry counts, draft quality scores, dedup/synthesis
status, degraded/fallback warnings and the winning engine's response. State is
invocation-local; finally-disposal clears the timer and progress, and late events
are ignored. It does not execute the workflow or import the legacy handler.
The existing no-legacy-handler guard remains unchanged.

Normal, recovered and fallback job launches now pass their job-owned abort
signal. A regression exposed cancellation during synthesis being converted
into a successful fallback. The generated handler now rethrows cancellation
and records a failed run; the normal continuation does not propose recovery
after the operator cancelled. This is a deliberate correctness repair, not
a claim of byte-equivalence to that legacy cancellation bug.

Negative evidence before fixes: ten event/record assertions failed, the physical
route lacked progress/draft/warning output, the job-signal gate failed, and the
synthesis cancellation test resolved successfully instead of rejecting. Tests
now cover those cases, renderer timer disposal and late events, isolated renderer
state, fallback visibility and cancellation before dispatch through the physical
route. The launch-site AST check is wiring evidence, not a live job-system test.

**A06 is still open.** This restores the bounded progress/result presentation
and status fields, not the entire legacy TUI lifecycle. Still reconcile project
context enrichment, chat/tracker/session-result persistence, scoreboard and
checkpoint/telemetry effects, CLI human/quiet formatting, and installed positive
workflow/terminal rendering with independent qualification. In particular, the
renderer tests do not prove visual layout or concurrent job-arena ownership.
No active installation, personal configuration or provider login was used.

Development verification: 6,124 tests pass with five existing skips across 518
files; full build plus the final CLI rebuild, typecheck, typed lint, re-export
guard and refreshed release/SBOM checks pass. Full-suite log SHA-256:
`c4a54360fa8a2c6642d57904ee8615118a68e8d0f847d7dda941831b3a49bce7`.
Lint log SHA-256:
`e385583285cd174dfac4b953e9703e348d29541088cadb8e1072f6478d28227d`.
These fixture-based development checks are not independent clean-commit release
receipts, native cross-platform qualification or a live terminal visual review.
The refreshed offline packaged-install run also passes all 69 checks, including
the guarded MCP failure contract, lifecycle, cache deletion and idempotence.

### Brainstorm generated-handler integration (2026-09-11)

The generated handler now calls the extracted `createBrainstormRuntime`; its
competing simplified parsing, scoring and seat loop have been removed. The
mod-owned `BrainstormHostServices` contract supplies host effects, not a callback
to a second workflow implementation. The common Mod API remains mode-neutral.
CLI and MCP supply the capability to Brainstorm and its bundled orchestration
consumer; unrelated mods do not receive it. Missing capabilities fail explicitly
instead of silently selecting a reduced workflow.

**A06-HOST-CAPABILITIES (KL-011)** is the temporary adapter owned by
`packages/core/src/blocks/brainstorm-host.ts`. It wires registry/adapter access,
ratings, protocol parsing, preflight, dedup and logs to the extracted runtime.
It binds dispatch to invocation cwd and cancellation. Remove it when those host
effects have final physical owners and both host decorators use those owners;
retain the raw workflow/effect-order and host-wiring tests as removal gates.
The existing forge compatibility exports are not retired by this change.

Ten frozen-oracle scenarios now compare the generated handler plus actual host
adapter with legacy raw results, dispatches, logger/rating/dedup effects: divergent,
grounded, empty/failed/throwing synthesis, no drafts, quarantine, partial panels,
dedup failure and retry-once. No successful-result normalization is used.
UI callbacks are outside that comparison; six existing scout comparisons remain.
MCP and physical Cesar route tests exercise the restored synthesis and degraded
panel shape. Host-wiring negative controls caught the missing capability in the
dependent orchestration mod before its CLI/MCP correction. These tests use fixture
engines, not live model providers or the operator's build pipeline.

Fresh development verification: **6,119 passed, five existing skips, 516 files**;
build, subsequent CLI rebuild, typecheck, lint, re-export guard, support source
boundaries, generated-dispatch self-tests and supply-chain metadata checks pass.
Full-suite log SHA-256:
`47cf25f9126e207df93ff1b6e14234acf3165de3ed4480aa071d959df4122f6d`.
Lint log SHA-256:
`4f0b5b843e2800efff7d6aa08a5b0a43ba8c083e0c5ddce3a968a419a9a6eeeb`.
Logs are in `/tmp/agon-brainstorm-verify-7YFkOIQh`; these are temporary diagnostic
artifacts, not repository-bound independent-review or clean-commit receipts.
Homes/config/cache prefixes were isolated and inherited credentials stripped.
A subprocess guard blocked live provider/browser commands; it is not a sandbox.

The installed MCP failure probe retains `isError: true` and now also requires
the real workflow's retry/drop diagnostic. Its restored run artifacts exposed
a verifier cleanup defect: file-mode chmod followed a run-directory symlink and
removed directory traversal permission. Cleanup now skips symlinks, retries
bounded transient removals and finishes before publishing a success receipt.
An injected final-cleanup `EACCES` exits nonzero with `FIXTURE_CLEANUP_DENIED` and
no success output (negative-control log SHA-256:
`2a130f1cf1c79d11f9353ccfd8152045a96a4fa7190f453c7226896cc0024ac3`).
The corrected offline packaged-install run exits zero with all **69 checks**,
15-package selected closure, cache-deletion survival and idempotence. Log SHA-256:
`4dc4f3278ab9cb7329ca0b88eca6d32ce2f4677c5c23f3bac74c298883ca5095`.
Its disposable cache was seeded from public dependency entries and the missing
React/Zod tarballs fetched with lifecycle scripts disabled; this is not evidence
that an arbitrary empty offline cache can install the product.

**A06 remains open** for installed workflow execution/oracle coverage, complete
UI event and persisted run-envelope parity, and independent qualification.
Run status formatting is not claimed byte-equivalent to the legacy handler.
The wider extraction, mutation, platform and release findings remain open.
No active/global installation or personal configuration was changed.

### Architecture gate recheck (2026-09-06)

The source-boundary gate previously inspected only `.ts` files with a regex for
static imports. It missed dynamic imports, `require`, import types, private
package subpaths and other source extensions, and could mistake comments for
imports. Its extracted old scanner failed 19 of 21 focused cases. It now uses
the TypeScript parser for canonical static/dynamic import, export, import-type,
import-equals, `require` and `require.resolve` syntax; includes TS/TSX/JS/JSX/MJS/
CJS/MTS/CTS files; rejects unparseable source and computed module targets; and
retains executable positive and negative controls. All eleven shared-support
packages pass that stronger source check.

Scope is explicit: this is not alias/data-flow analysis, an evaluation sandbox,
symlink qualification, whole-product behavior parity or runtime singleton proof.
The success message no longer claims runtime kernel uniqueness from peer
declarations alone. Aliased loaders and injected/native behavior still require
their own evidence; this check must not be cited as proof of their absence.

The S6 declaration/cutover verifier also failed because its old string marker
expected a two-argument MCP invocation. The implementation already forwards
`controller.signal` as its third argument. The verifier now inspects call syntax,
requires the request-bound signal, and rejects source mutants that remove the
signal, swap inputs or remove dispatch. Its output labels the empty *declared*
surface-adapter list and explicitly does not claim legacy adapters were removed.
The separate kill-list ownership check passes 15 assigned entries; assignment
is not removal evidence. Hardcoded zero-adapter coverage claims in older slice
qualification scripts remain superseded by this product audit, not accepted.

The architecture is still **not release-ready**: A05, A06, A10 and A11 remain
open, alongside the later product findings below. Source checks and catalog
counts cannot close those behavioral, migration and independent-review gaps.

Gate-repair development evidence: 21 focused source-boundary cases pass, as do
the source/cutover CLI self-tests, full build, typecheck, lint and re-export guard.
Full suite: 6,105 passed, five existing skips, 516 files. Full log SHA-256:
`35632b736a4d4911f8c64f0b3ebebc3e0f805b302ff60fb223ca4fc6f23d4bf6`.
Build log SHA-256:
`9934bb65fa97343ef2afc38b362c664ed535ac23d8b72ed3809e4df3262ae44e`.
All 69 isolated packaged-install checks, supply-chain self-tests and 27 canonical/
compatibility asset-pair checks pass. npm provenance remains externally blocked.
No runtime source or active/global Agon installation changed in this gate repair.
These are development checks, not an independent release qualification receipt.

The read-only audit packed all 49 target packages and the CLI, then installed
offline in a temporary prefix. Initial CLI startup, engine listing, mod listing
and full-compat setup worked. After approved Think disable, fresh commands
failed with `selected canonical lock does not match the resolved package
closure`. Kernel safe mode successfully restored generation 1 and normal
startup. Packaged MCP separately returned `Engine "codex" not found`, while
packaged CLI recognized Codex. Fixture calls reproduced A04–A06 without calling
providers. A08–A11 were source-traced and must not be represented as completed
end-to-end reproductions.

Original local diagnostics: `/tmp/agon-product-audit-01jLeK/REVIEW.md` and its
adjacent scripts/logs. These ephemeral paths are investigation aids, not
portable release receipts. Permanent regression tests and recorded verification
must replace them before any finding is closed.

CI failure: <https://github.com/KERNlang/agon/actions/runs/33962141678/job/101295755942>
(lint, heap exhaustion, exit 134).

## Re-audit scope

Recheck installed CLI/MCP/TUI dispatch, activation/dependency/profile/restart
sequences, package assets and boundaries, raw workflow parity, persisted state,
trust/grants, recovery, negative controls, performance and CI. Test behavior at
the real composition boundary rather than only isolated legacy helpers.
Every repair requires a failing-before/passing-after regression. Do not weaken
acceptance gates or update clean-subject receipts to describe dirty code.

Native platform qualification, publishing and live-provider coverage remain
separate. Dependency vulnerability auditing requires authorization to disclose
dependency metadata to the registry; the blocked network audit was not bypassed.
No claim of exhaustive security or perfection follows from local green tests.

## Repair contracts

- `first-party-activation.ts` owns selection changes against a qualified
  inventory. `installed-index.json.lockedPackages` retains exact lock identities
  across disable/re-enable. Older generations seed it from their verified
  active lock; missing packages require setup, never an invented identity or
  implicit download. Selection preserves `installation.json` byte-for-byte.
- Activation recomputes the effective package closure from the desired state,
  then validates graph hash, ordering and closure before the commit point.
  An internally self-consistent but incomplete lock is a negative control.
- CLI authority checks run in citty's setup phase, before nested commands.
  A command may complete its own approved generation change; a subsequent
  invocation by a stale host still fails.
- TUI-specific schemas/adapters preserve existing intent fields and convert
  them into the domain handler's request. CLI schemas are not loosened.
- Folder-mod engine calls use an explicit host capability, through existing
  trust/grant wrappers, not a compatibility-tool stub. Bundled and external
  callers share the host engine implementation; external callers retain their
  authority checks and live revocation.
- `mod-observability.ts` owns immutable UUID receipts, owner/content attribution,
  redaction, size limits and log receipts. First-party receipts live under
  `first-party-mod-data/<mod-id>/receipts`; external receipt paths stay compatible.
  No receipt is returned before its write completes.
- Lint discovers the exact file scope using ESLint, then validates every file
  with unchanged rules in isolated workspace processes. Discovery is not a
  passing lint result. No directory/rule exclusion or warning allowance was added.

## Deeper review findings

**A12 — Chrome and Synthesis TUI contracts (repaired).** A census of 89 parsed
samples exposed forbidden `input` on Chrome and missing `prompt`/numeric `swaps`
on Synthesis. Explicit TUI schemas and adapters now preserve legacy intent
shape while delivering the correct domain request. Tests exercise the actual
registered parser, schema and handler with fixture capabilities.

**A13 — Apply-patch routing repaired; backend extraction remains open.**
The registered Apply intent previously used the Forge task schema and competition
handler: `/apply <patch-path>` failed for missing `task`. Apply now has its own
schema, parser and handler in `packages/mod-forge/src/apply.ts`. It never starts
a Forge competition. The existing preflight, current-plan artifact selection,
preview and approval remain behind an explicitly temporary host adapter.

Adapter ledger entry **A13-APPLY-HOST**, under **KL-011** surface cutover:

- Contribution owner: `agon.forge`, IDs `intentVariants:0002`,
  `builtinCommandMetadata:0002`, and `tuiSlashCommands:0002`.
- Adapter owner: CLI interactive host, `packages/cli/src/patch-application-host.ts`;
  legacy workflow: `packages/cli/src/handlers/plan.ts::handleApplyPatch`;
  legacy backend: `packages/core/src/blocks/patch-apply.ts`.
- Boundary: optional public `PatchApplicationHostServices`, injected only into
  bundled `agon.forge`. UI context stays inside the host. Invocation-scoped
  approval callbacks reject headless, mismatched and expired sessions and keep
  concurrent sessions separate. Availability is not approval or sandboxing.
- Removal condition: extract the patch workflow/backend into its physical
  mod/support owner, leaving only preview/approval UI capabilities in the host;
  prove parity and legacy-adapter unreachability before deleting this bridge.
  This entry is **retained**, not a completed kill-list removal.
- Evidence: `tests/unit/modular-apply-route.test.ts`,
  `modular-apply-approval.test.ts`, `modular-apply-host-scope.test.ts`, and
  `modular-apply-tui-integration.test.ts` in the same directory. Tests cover the
  registered parser/schema/runner and actual TUI dispatch/approval bridge with
  a fixture patch backend; they do not prove every real Git failure mode.

The approval repair accepts only empty input (the existing `[Y/n]` default),
`y`, or `yes`; previously only literal `n` cancelled. Cancellation after the
prompt prevents the write. The workspace is pinned before preview, and relative
patch/manifest paths resolve against that workspace. `--force` bypasses the
dirty-tree refusal, not human approval. These checks do not supply a repository
transaction lock or complete concurrent-writer recovery. Full artifact/backend
parity and extraction remain part of A11/A13.

Apply repair development verification (2026-09-05): 12 focused tests and the
rebuilt full suite pass (5,970 passed, five existing skips, 496 files). Build,
typecheck, lint, re-export guard, all 49 package packs plus launcher, 69 isolated
npx checks, and SBOM validation pass. Packed total: 1,820,382 bytes. Full-run
log SHA-256: `3bf16be4401b145fe2b1118e5dd2850510427b9fea2ae1bfad52d7f8080e61bb`;
npx log: `4dc4f3278ab9cb7329ca0b88eca6d32ce2f4677c5c23f3bac74c298883ca5095`.
These are local development results, not independent clean-commit release
qualification or proof of complete workflow parity. npm provenance remains
externally blocked. Active/global Agon was not installed, linked or promoted.

The census also rejects empty `/forge` and `/team-forge` inputs lacking a test
command. Those are incomplete inputs, not by themselves proof of a regression.

**A14 — MCP command failure envelopes (repaired; workflow parity remains separate).** The guarded packaged Brainstorm probe
reaches a deliberately blocked provider dispatch, but emits an ordinary MCP
result containing failed seats instead of an error result. Command-to-tool
adapters currently discard some nonzero exit codes. Establish one consistent
failure projection and test all-failed, partially degraded, cancelled and
successful panels across the generated MCP surface. Do not confuse this
remaining failure-contract bug with the repaired engine asset discovery.

Follow-up after repair commit `7095456a`: the public Mod API now supplies
`commandResultToToolResult` and `CommandExecutionError`. Successful payloads
retain their existing shape; nonzero exits throw a typed error preserving the
exit code, typed failure metadata and diagnostic result. Brainstorm, Campfire,
Tribunal, Nero, Synthesis, Forge, Review and RAG use this common conversion.
Plan, Jobs, Agent and pipeline-orchestration adapters also use this conversion;
pipeline coverage here stops at invalid-input validation and runs no stages.
The generated MCP transport maps that error to `result.isError: true`, not a
successful payload or an internal JSON-RPC error. Internal result diagnostics
are not automatically copied into the wire response.

Regression coverage includes every migrated adapter, an all-failed Brainstorm
panel, a degraded successful panel, actual server wire serialization, successful
falsy payloads, and failure/cancellation exit metadata. The npx qualification now
launches the installed MCP server with provider subprocesses/fetch blocked and
asserts successful RoomList, failed Brainstorm, missing JobStatus, cyclic
ProposePlan, and unknown-tool protocol behavior. This checks the actual packed
API/error-class boundary, not only source imports.

**A17 — Array schema constraints rejected (repaired).** The packed ProposePlan
probe exposed that the shared validator rejected the owner's `minItems` keyword
before invoking the handler. It now enforces nonnegative safe-integer
`minItems`/`maxItems`, inclusive limits and per-item validation. Seven negative
and boundary tests pass. Unknown keywords remain rejected; the Plan constraint
was not removed or weakened.

**A18 — MCP cancellation signal disconnected (repaired at the generated
transport boundary).** Dynamic calls now own per-request controllers, forward
their signals to the generated invocation context, accept matching cancellation
notifications and suppress cancelled replies. Numeric/string IDs stay distinct;
unknown cancellation is ignored; duplicate in-flight IDs cannot overwrite the
controller; transport close aborts active controllers. Tests cover cancellation
before dispatch and cancellation of one concurrent request without cancelling
the other. This follows the server's advertised
[2024-11-05 MCP cancellation contract](https://modelcontextprotocol.io/specification/2024-11-05/basic/utilities/cancellation).
This is cooperative cancellation, not a claim that every engine immediately
terminates or that kernel write-tool cancellation has been implemented.

Updated verification: full suite **5,958 passed, five existing skips**, 492 files;
installed npx **69 checks**; build, kernel rebuild, typecheck, lint, re-export,
pack-content and local SBOM checks pass. Full-run log SHA-256:
`fa134847548762e02df861902f2cfbd8599f7e760d450380d2a95b2e4aaf6cbb`.
Installed-run log SHA-256:
`4dc4f3278ab9cb7329ca0b88eca6d32ce2f4677c5c23f3bac74c298883ca5095`.
These development checks do not supersede release acceptance receipts or close
the Plan/Apply/Brainstorm behavioral parity, extraction or mutation findings.

**A15 — Intermittent daemon survival test (unresolved observation).** One
unsandboxed full run returned no pong; the isolated three-test daemon suite and
subsequent full runs passed. No root cause was established and no timeout was
raised. Retain this observation for load/repetition tests; it is not evidence
that the flake was fixed. Earlier EPERM socket/watch failures were environmental
and were rerun with local permissions, without skips.

Apply-repair verification also produced one daemon readiness failure (5,969
passed, one failed, five skipped). That run overlapped a build rewriting the
CLI distribution used by this test, so it is not a valid stable-artifact
qualification run. Failed log SHA-256:
`d7c45f26eb8a076a9f1e696a85cd3489f4bc4b96505b17e8190b5a23d5554a84`.
Build completion must precede the rerun. This interference is a plausible
explanation, not a verified root cause of the earlier no-pong observation.

## Remaining clean implementation order

**A06 — Brainstorm workflow controller physically extracted (partial progress).**
`packages/mod-brainstorm/src/workflow.ts` now owns the existing preflight-to-result
sequence: panel degradation reporting, bid assembly, deduplication coordination,
rating-update ordering, synthesis prompt construction, synthesis failure fallback,
events, sidechain records and final result assembly. It imports no private core,
CLI or forge implementation. Engine/storage/native effects are injected through
`BrainstormWorkflowServices`; the public package compiles independently.

**A06-BRAINSTORM-HOST (KL-011)** in `packages/forge/src/brainstorm.ts` is a
temporary capability adapter. It delegates the workflow controller but still
supplies host capabilities only. Collection, scout orchestration and policy are
now extracted as described below. Its removal condition is connection of the
generated surfaces to the same workflow, and installed raw-oracle parity. The
simplified `mod-brainstorm/src/implementation.ts` surface implementation still
exists and is **not** accepted as equivalent. A06/A11 remain open.

The independent frozen source fixture is from `f68d41e4`, with relative imports
relocated only. Nine comparisons check raw results/errors, dispatch arguments,
events, logger records, dedup inputs and rating writes: divergent, grounded,
empty/nonzero/throwing synthesis, no usable drafts, full quarantine, partial
quarantine and a dedup abort. No normalization hides missing fields or reorders
events. The ownership guard failed before extraction and passes afterward.
These fixture tests do not constitute live-provider or installed-surface parity.

Development verification: independent mod build, repository build, typecheck,
lint and re-export guard pass. Full suite: 6,033 passed, five skipped, 507 files.
Full log SHA-256:
`14974322ef355e2014f81b59338d50471a53086b0ab0a5c8b1a64f0bc505112b`.
Build log SHA-256:
`e4146c69028700f8896b11b5f00d0b41385c51e0c22e0e9cc8a9733dbb6d02fa`.
The unrelated timing-oracle failure and its mutation-checked repair are recorded
in [the lock-test repair receipt](evidence/modular-agon-file-lock-test-repair.md).
This is not an independent clean-commit release qualification receipt.

**A06-BRAINSTORM-POLICY (KL-011), subsequent extraction.**
`packages/mod-brainstorm/src/policy.ts` owns structural/scout scoring, stance
assignment, fallback parsing, confidence calibration, quality scoring and stable
ranking. The legacy module retains exports and supplies the rating reader only;
the policy reads history on each call rather than caching a stale snapshot.
The injected history shape exposes wins/losses, not private registry or store
implementations. The remaining collector and scout use these physical helpers.

An ownership regression failed before the move. Eleven additional parity cases
compare against the frozen source, including score thresholds/caps, grounded vs
divergent scoring, cold-start history, mode/global precedence, live history
changes, stable ties, entry identity, fallback parsing and stance pool overflow.
The nine workflow-oracle comparisons remain green. This moves policy ownership;
it does not yet replace the simplified generated-surface handler. A06 remains
open until collection/scout extraction and installed-surface parity are complete.

Policy-extraction development checks: independent package build, repository
build, typecheck, lint and re-export guard pass; 6,045 tests pass with five
existing skips across 509 files. Full-suite log SHA-256:
`2eb0271415b8013bf8d43f61b4a87d424a152d441b80524550f778f5de247952`.
Build log SHA-256:
`bc34a0fd6d59b888454df3504689b10f330b9219499b3b0a82a096312e10722f`.
The initial lint pass identified a leftover unused import; it was removed and
the complete lint rerun passed. These checks do not close release qualification.

**A06 collector/scout extraction.** `collector.ts` and `scout.ts` in the physical
Brainstorm package now own prompt/stance assembly, seat event ordering, parsing,
collection, ranking, scout selection, timeout capping and scout result assembly.
They import no private core, forge or CLI code. The compatibility module supplies
protocol functions, rating reads/writes, engine dispatch, health and dedup effects;
it no longer contains those workflow algorithms.

The ownership guard failed before extraction. Six scout cases compare raw bids,
engine lookups and dispatches against the frozen implementation, including zero,
one/default/overflow counts, partial quarantine and failed seats. A positive
retry case checks the full workflow's four seat attempts plus one synthesis.
The workflow/scout oracle now covers sixteen cases. These are fixture results,
not installed-surface or live-provider acceptance.

Surface integration is still required: the generated handler must gain the real
protocol, history, preflight, dedup and run-record capabilities and use these
factories. Its simplified implementation must then be removed, with negative
reachability and installed raw-oracle checks. A06 is not closed by this move.

Collector/scout development verification (2026-09-06): independent mod build,
repository build, typecheck, lint and re-export guard pass. The full isolated
suite passes 6,053 tests, with five existing skips across 510 files. Full log
SHA-256: `13efa6527e29c4c6eb7f74ca6af56a04a3c678ca7be3ae087064ce582fcb2441`.
Build log SHA-256:
`f0b092cd9c4fe851f373b62a6a2d5c40e002662bf8c4550ad983bb8577eac8d3`.
All 69 packaged-install checks pass; the release set and SBOM agree on 50
components including the launcher. Supply-chain negative controls pass; npm
provenance remains externally blocked. No live-provider call or active/global
installation was used. These are development checks, not an independent
clean-commit release qualification or closure of the remaining product audit.

**A06 dispatch-contract prerequisite (2026-09-06).** The public engine-dispatch
options now include the adapter's optional `textOnly` control. Both CLI and MCP
hosts forward it; the generated Brainstorm handler requests it for every seat,
as the legacy collector already does. No other mode's default is changed. This
is adapter control, not a sandbox or a guarantee that every provider supports
disabling tools.

The same trace found that folder-mod dispatch discarded *all* options in the
worker proxy, parent worker bridge, grant wrapper and bootstrap adapter. These
layers now forward the options through to the host. Invocation context and
cancellation remain host-bound, and live grants are still checked before calls.

One parameterized contract harness exercises the actual CLI/MCP host functions
against a recording adapter, covering true/false/omitted text-only controls,
timeouts, modes, prompts, context, unchanged defaults, raw results and thrown
failures. Tests failed before the forwarding repair. The physical folder-mod
bootstrap test also failed with missing options; it now checks the complete
worker path, rejects a caller-supplied working-directory substitution, and proves
grant revocation prevents a second dispatch. Existing raw Brainstorm oracle
comparisons remain in place. Tests use local fixtures, not live providers.

This fixes dispatch-contract loss, not the still-open synthesis/calibration/
dedup integration in A06. The simplified generated workflow is not accepted as
equivalent to the physically extracted workflow.

Dispatch repair development checks: build, typecheck, lint and re-export guard
pass. Full suite: 6,063 passed, five existing skips, 511 files. Full log SHA-256:
`8e2c1c73fad546c7f9d0a280721628fbf0eb041319db8860b3f5161e568bc674`.
Build log SHA-256:
`fed6456554eb8be888c9a6e68fce043debbaf0df7b6440efb2d740033267aff0`.
The complete build was rerun after the worker changes, so source tests and
packed runtime artifacts do not refer to different implementations. These
checks are not independent clean-commit release qualification. All 69 isolated
packaged-install checks and supply-chain self-tests pass; npm provenance remains
externally blocked. The active/global installation was not modified.

**A06 dedup bridge extraction (2026-09-06).** Shared dedup support now physically
owns `brainstorm-dedup.ts`: optional sidecar discovery, JSON-lines input/output,
status conversion, timeout, cancellation and child termination. Its group/status
types also have one owner; core retains type re-exports. The legacy forge bridge
is only the **A06-DEDUP (KL-011)** compatibility export and declares its support
dependency explicitly. Remove that export when the last legacy Brainstorm
capability adapter is removed; the ownership test forbids restoring its controller.

The test harness freezes the exact bridge body from `192ab0d3`, protected by
SHA-256 `018cf770c252baf8a8b3b49dedc0d32bf7ca346de13b2e56d25221fb1577312e`.
Sixteen scenarios compare raw results, errors, child-process arguments, stdin
writes, termination signals and remaining timers. Cases cover zero/one drafts,
missing sidecar, synchronous/asynchronous spawn failure, split output chunks,
success, invalid JSON, malformed/missing groups, unavailable/failed exit,
timeout, cancellation before/after spawn, late close and stdin failure. No
Python process or provider runs in this simulated-process harness. The existing
real-process timeout test remains part of the repository suite.

Ownership tests failed before the controller/type move; the new comparisons and
existing Brainstorm workflow oracle pass afterward. This is a behavior-preserving
extraction, not a redesign of sidecar output validation. Generated Brainstorm
surface integration, native dependency qualification and A06 closure remain open.

Dedup extraction development verification: independent support-package build,
repository build, typecheck, lint and re-export guard pass. Full isolated suite:
6,081 passed, five existing skips, 513 files. Full log SHA-256:
`9889d97365670d082394a197f921cf8caa4936a04821de4f1582596b5e274e15`.
Build log SHA-256:
`0a5818b54ff35b8b7d9791c0c647cb4f434834a67d150264a98a0f76daa2cb23`.
All 69 isolated packaged-install checks and supply-chain self-tests pass. The
release set contains 50 components including the launcher; npm provenance is
still externally blocked. The active/global installation was not modified.
This is development evidence, not independent clean-commit release qualification.

**A06 runtime composition (2026-09-06).** `mod-brainstorm/src/runtime.ts` now
provides one `createBrainstormRuntime` factory assembling scoring, collection,
scouting and the full workflow. Its public `BrainstormRuntimeServices` contract
contains injected host effects, not private core/forge types. Construction is
lazy: it does not read ratings, dispatch engines, create logs or touch state.
The compatibility adapter now supplies effects to this factory rather than
assembling the four components independently. Its options are a readable typed
extension of `BrainstormWorkflowOptions`, not a duplicate inline shape.

The ownership regression failed before the move. Existing ownership guards now
check factory assembly in the physical runtime while retaining prohibitions on
legacy algorithms and private imports. All sixteen workflow/scout and eleven
policy oracle comparisons remain unchanged and pass. New runtime checks cover
effect-free construction, immutable scout options, timeout capping, retained
host state and omission of scout-inapplicable style/event/count controls.

The generated surface handler still needs to consume this runtime with qualified
host capabilities; it has not been silently redirected to the legacy entrypoint.
A06 remains open until that integration and installed-surface parity are proven.

Runtime composition development verification: independent mod build, full build,
typecheck, lint and re-export guard pass. Full suite: 6,084 passed, five existing
skips, 515 files. Full log SHA-256:
`f2637d683445ef80dcbe2be8923d67b71e1cbf76822b551881d07ac3a9236e9d`.
Build log SHA-256:
`051a4dba2337aea7236d63e2592983994924eb04c7fa98e165611d2baf72ca73`.
All 69 isolated packaged-install checks and supply-chain self-tests pass;
npm provenance remains externally blocked. Active/global Agon was not modified.
This is not independent clean-commit release qualification.

**A20 — Plan scheduler physically extracted (partial A05/A11 progress).**
`packages/mod-plan/src/executor.ts` now owns the scheduling loop: dependency-ready
selection, parallel/sequential execution, running-state publication, output
summarization fallback, context export, cost callbacks, budget warnings and abort
return state. `execution-model.ts` owns the existing public execution-plan types
and step-type constants. Neither module imports private core or CLI code.

The scheduler factory injects the step transition and cost-recording operations.
The initial scheduler commit retained both host implementations; the subsequent
state/store extraction below moves the transition implementation into Plan.
Cost-history recording remains a host operation.
The old core scheduler is replaced, not duplicated. Compatibility entry
**A20-PLAN-SCHEDULER**, under **KL-011**, is the narrow wrapper in
`packages/core/src/cesar/plan-executor.ts`. Core's model module re-exports the
Plan-owned types instead of defining a second model. Core's explicit dependency
on the physical Plan package and TypeScript project reference preserve clean
build ordering. No new dependency is added within the 49-package release graph.

Removal condition: migrate remaining runtime callers to Plan activation with
injected transition/cost services and prove the wrapper unreachable, then delete
the core dependency/export. Until then this adapter is retained and A11 is open.

Oracle: `tests/fixtures/modular-plan-executor-legacy.ts`, frozen from `f6fc22f2`
with import paths adjusted only. The ownership/parity test compares raw event
order, context, results and cost records for sequential, parallel, failed,
paused, thrown, missing-executor, aborted and summarizer-failure cases. The
oracle shares the unchanged legacy transition function, so it qualifies the
scheduler extraction, not independent state-machine correctness. The guard
rejects a scheduler loop restored in core or a private-core import in the mod.

Separate actual mutation evidence:
`tests/unit/modular-plan-scheduler-mutations.test.ts` transforms the scheduler's
own TypeScript source in memory, compiles and executes each candidate, proves
the unmodified implementation satisfies the oracle, and proves three deliberate
changes violate it: ignored cancellation, dropped ready steps and suppressed
budget warnings. **3/3 targeted scheduler mutants detected**. This is not a
whole-project mutation score and does not close A10's manifest/resolver/registry
mutation requirements. No production file is mutated by the test.

Development verification: 6,003 passed, five existing skips, 500 test files;
build, post-build typecheck, lint, re-export guard, 49-package/launcher packing,
69 isolated npx checks and SBOM checks pass. Full-run log SHA-256:
`cbeeb570987556b22a07e0660de740d8c429916a6779a1e2b5ba6a7e21360c0a`.
No active/global installation was promoted. These checks do not close the
session-routing, persisted-model reconciliation or final native-release cells.

Follow-up physical extraction: `execution-state.ts` owns creation, approval,
step transitions/dependency release, cancellation and exit. `execution-store.ts`
owns canonical JSON/Markdown paths, atomic save, canonical/legacy reads and
listing. It uses the public support-persistence path/envelope helpers. The old
core `plan.ts` is now only explicit compatibility exports, tagged
**A20-PLAN-STATE/STORE** under KL-011. No state or filesystem implementation remains
there. The scheduler adapter injects the Plan-owned transition directly.

Frozen state/store fixtures and `modular-plan-state-owner.test.ts` /
`modular-plan-store-owner.test.ts` compare full state payloads, persisted envelope
bytes, readers and malformed-file isolation. The existing core-import Plan
tests continue through the compatibility facade. The equivalent host-clock
wrapper is replaced by `new Date().toISOString()`; timestamp call semantics are
retained. Path resolution uses `persistencePath`, whose implementation matches
the legacy `runtimeAgonPath`, including the dynamic AGON_HOME override.

These facades must be deleted after owner-checked consumers migrate. They do
not authorize disabled Plan workflows. The separate simplified persisted-plan
controller in `implementation.ts` is **not yet reconciled** with the extracted
execution model. A05/A11 remain open until session routing, approvals, execution,
historical reads and disabled reachability use one verified path. Preservation
of existing storage behavior is not proof against every concurrent-write or
malformed-payload case; those remain qualification dimensions.

State/store follow-up verification: 6,008 tests pass with five existing skips
across 502 files; build, post-build typecheck and re-export guard pass. Full-run
log SHA-256: `4d5caa8d1ba1f9dfff681be373f004316df9f1a89e582dd9ec7436396d0797a2`.
The final full suite ran after build completion without concurrent build/lint
work. This does not resolve the earlier intermittent telemetry observation.
Lint, all 49 modular package packs plus launcher, 69 isolated npx checks and
SBOM validation also pass for the follow-up. npm provenance remains external;
no active/global installation was changed.

**A21 — Telemetry fallback intermittently misses the expected successor (open observation).**
The first full scheduler-extraction run passed 6,002 tests and failed
`telemetry-fallback.test.ts:170` (expected a staller → backup fallback). Failed
log SHA-256: `b5c9c61bc42fa8b92a6e424b5c56cf11544f96c1c512cf83e2e110d00ab01338`.
An unchanged rerun without concurrent lint/package load passed. Inspection shows
the test samples live time, PID/network heartbeat and fallback availability,
and waits for fallback before starting its fixture Forge. This is a diagnostic
lead, not a proven cause. No assertion, timeout or production behavior was
changed to make it pass. Retain this for deterministic telemetry qualification;
do not report the intermittency fixed.

**A19 — Plan approval interprets refusal as consent (repaired at the legacy boundary).**
While tracing A05, `handlePlanShow` was found to reject only literal `n`;
`no`, `cancel`, and arbitrary text entered the approval branch. It now accepts
only empty input (the displayed `[Y/n]` default), `y`, or `yes`, ignoring case
and surrounding whitespace. Other replies cancel and persist the cancelled plan.
`resumeCesarPlan` likewise treated every answer except its three cancellation
aliases as permission to resume. It now requires `1`/`resume` or
`2`/`r`/`restart`; blank and unknown responses leave the paused plan unchanged.
The choice UI maps Enter to the selected choice key, not blank input.

The actual keyboard path also resolved Ctrl+C and free-text Escape dismissal
as `''`, accidentally selecting affirmative defaults. Both now return `n`,
matching the existing choice-question refusal path. Two failing-before tests
in `tests/unit/question-cancel-refusal.test.ts` cover the real keyboard handlers.
This retains the legacy string-answer interface; it is not a universal typed
cancellation contract for every free-text workflow.

Development verification: 21 focused regressions pass; the full rebuilt suite
passes 5,991 tests with five existing skips across 498 files. Full-run log
SHA-256: `3c57c3adde26d60563aa83a36d50fe4eb3e21a0b0a11e12c09f057dfe07a1117`.
All 49 modular packages plus the launcher pack successfully (1,820,402 bytes),
69 isolated npx checks pass, and SBOM validation passes. The final post-build
typecheck passes; an intermediate typecheck overlapped the build's declaration
cleanup and reported missing built declarations, so it is not qualification
evidence. Active/global Agon and personal state were not promoted or modified.

`tests/unit/plan-approval-refusal.test.ts` exercises the actual handlers with
fixture persistence/execution: ten refusal cases failed before the repair;
all 19 cases pass afterward, including affirmative/default draft approval and
explicit resume/restart. No model or live plan storage is needed by this test.
This is a prerequisite safety repair, **not** closure of A05 or A11. Cancellation
signal propagation, current-session selection, persistence-format compatibility,
and physical Plan workflow extraction still need integrated qualification.

The A05 source trace distinguishes three contracts that must not be collapsed:

- New task: `/plan <task>` enters Cesar plan mode and proposes a new plan.
- Resume: `/plan resume [id]` resumes only a live session plan without an ID;
  an explicit ID/path permits loading a saved plan. It must not silently use
  the newest persisted plan.
- Control: approve/cancel must address the visible Cesar proposal or the legacy
  session plan and execute/persist the corresponding state transition, not merely
  change the state of an unrelated `cplan-*` record.

The physical Plan mod now routes TUI controls through `PlanSessionHostServices`,
an invocation-scoped public contract. Task, resume, inspect, approve, retry,
cancel and autonomous task requests remain distinct. No interactive host means
exit 2, never fallback to selecting or modifying the latest persisted record.
`/plan resumeDatabase` is a task, not a resume command.

**A05-PLAN-SESSION-HOST (KL-011)** is a temporary CLI-owned adapter in
`packages/cli/src/plan-session-host.ts` and `signals/dispatch/intent-session.ts`.
Only the bundled Plan mod receives it. It rejects missing, mismatched, expired
and already-aborted invocations. UI callbacks do not cross the public API.
The adapter preserves the existing session handlers, including proposal
approval and explicit-ID resume, rather than duplicating their algorithms.

Removal condition: migrate session coordination and approval/execution policy
to the physical owner, prove raw event/state parity, then delete this adapter
and assert no imports of the legacy Plan session handlers remain. That removal
gate is not satisfied. Fifteen new route/scope/TUI tests cover this increment;
they do not qualify live-provider execution, nested job cancellation, all
installed surfaces, or MCP/Cesar's separate persisted-record controller.
A05/A11 therefore remain open, not accepted as complete extraction.

Regression evidence: all eleven new routing cases failed against the previous
controller and passed after the session split. The first full run had 6,022
passing tests, five skips and one obsolete expectation in the Plan package test:
it required headless TUI approval to mutate a saved record. That assertion is
replaced with exit-2 refusal **and exact persisted-record equality**; proposal,
listing, exit and cycle-validation assertions remain. Existing interactive
approval/refusal tests remain unchanged. Failed-run SHA-256:
`884c476883f763f9b514773c7e5b6fa6c6293bad50eda0cf97f48e81326bbc3f`.

Final development verification: build, typecheck, lint and re-export guard pass;
6,023 tests pass, five remain skipped, across 505 files. Full-suite log SHA-256:
`834e8da3ebf8cc06494f019c866c2e7605dc978d4358f1435247234b9c6c9ff9`.
Build log SHA-256:
`9253f472377af8dfd0c6f41b51f3c61df32894e8e3f13fe44c56082ce3a305a2`.
This is a working-branch repair receipt, not independent clean-commit release
qualification or closure of the outstanding architecture findings.

**A16 — Serve readiness/shutdown race (repaired; regression suite passing).**
The latest combined run had 5,923 passing tests, five skips and one failure:
`serve-command.test.ts` received a null process exit code after SIGINT rather
than zero. Source inspection found that `runServe` published its connection
before registering signal handlers. A deterministic regression emits SIGINT
at publication and fails before the fix. Shutdown handlers now precede the
ready line; concurrent abort/signal requests share one disposal, synchronous
stop errors enter the existing error path, and the abort listener is removed.
The four browser delegation tests, package compilation and targeted lint pass.
This establishes the readiness defect, not proof that it explains every
previous daemon flake. The rebuilt full suite subsequently passed: 5,925 tests,
five existing skips, 488 files. Build, typecheck, lint and re-export checks pass.
The diagnostic launch guard initially misclassified harmless argument strings;
it was corrected to inspect executables, without changing application tests.
Guarded full-run log SHA-256:
`65f6a2fc54cdd578739d2b5ead488bec225ee732944b0d1c11838adff793f7d4`.

During this run the operator reported unexpected OpenAI login tabs. Their
origin was not established. Subsequent narrow tests block child processes
(except the exact local esbuild service) and fetch, using fixture browser
services; no browser or provider authentication is needed by those tests.

1. **Plan session boundary (A05/A11):** extract plan state transitions and
   execution ownership into the plan package. Give the UI an explicit event,
   approval and session bridge; do not pass the whole CLI callback/context
   object into mods. Preserve new-task planning, in-session selection, explicit
   resume, approval, cancellation, retry and self-review gates. A typed,
   owner-tagged temporary adapter may bridge the old session implementation,
   but must have a removal test and must not be mistaken for completed extraction.
2. **Brainstorm workflow owner (A06/A11):** move the actual preflight → seat/retry
   → calibration/ranking → dedup → ratings → synthesis workflow behind injected
   host capabilities. Replace legacy exports with a narrow compatibility adapter
   to that one implementation. Preserve raw result fields, event order, degraded
   panels, cancellation and synthesis fallback. Use deterministic fixture engines
   to compare old/new raw outputs and dispatch sequences before retiring the owner.
3. **Apply extraction (A13/A11):** routing is separated from competition and
   MCP failure projection is repaired. Retire A13-APPLY-HOST only after physical
   backend extraction and artifact/approval parity pass; keep the approval gate.
4. **Acceptance truth (A10/A11):** inject actual implementation mutants, reconcile
   remaining legacy owners, then run raw workflow parity through installed surfaces.
   Existing legacy-only tests cannot close these findings.

## Verification recorded during this repair batch

- All 36 first-party mods: durable disable/re-enable, fresh surface bootstrap,
  identity retention and disabled-owner rejection across CLI/TUI/MCP/Cesar/docs.
  This is registration/activation coverage, not execution of all 36 workflows.
- Installed npx test: **68 checks**, including cache deletion, Think lifecycle,
  fresh process startup, disabled rejection and preserved idempotent setup.
- Full suite before the new 36-case matrix: **5,888 passed, 5 existing skips**,
  487 test files. Matrix separately passes all 36 cases.
- Typecheck and re-export guard pass. Typed lint passes under a 4 GiB heap;
  the latest recorded scope before the matrix file was 1,300 files/55 partitions.
- Rebuilt package BOM/channel and matching local SBOM; these are artifact
  metadata, not an assertion of completed release qualification or publication.
- Packaged MCP resolves Codex and reaches dispatch with process/network effects
  deliberately blocked by a probe preload. No live provider or credentials used.
- Regression tests were observed failing before their corresponding repairs.
  Existing Think intent assertions were retained; an initial incompatible parser
  change was corrected by an adapter, not by relaxing those assertions.

Local logs for this batch: `/tmp/agon-product-repair-6JKB0sFB/`. They are development
diagnostics, not clean committed release receipts. This is an incremental repair
batch, not a release acceptance receipt. No active/global installation or personal-state changes were
intentionally performed; absence of indirect authentication side effects has
not been independently established. The PR is
still **not release-ready** because the open behavior and acceptance findings
above remain locally actionable.
