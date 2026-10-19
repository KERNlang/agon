# Goal / Forge integration evidence

## TUI Goal registry execution

Date: 2026-10-19. TUI `/goal` no longer executes `/bin/sh -c` with an `agon`
binary selected from PATH. It parses quoted arguments against the selected
generated CLI schema, then invokes the physical registry route used by Cesar.
There is no second Goal option catalog or new dependency. Shell expansion and
unquoted shell operators are rejected. Single-quoted gate text remains literal.

The queued job captures its generation and working directory. Execution checks
the generation again and passes the job AbortSignal. The captured directory
replaces the CLI schema's process-directory default; explicit relative `--cwd`
values resolve against that captured directory. Background job tracking remains.

| Receipt | Result | Log SHA-256 |
|---|---|---|
| goal-tui-registry-red | Ten tests failed on the old shell dispatch | b806102f70278358c8ed0f13f7db36adfa8ffb0c0082dbd63125b81f0718a34d |
| goal-tui-captured-directory-red | Both review directory cases failed | 0d7e115c10ff5d53b2196c85e7395d324eb6fd033d4a2fc543bd6e54a2205c57 |
| goal-tui-registry-real-route-final | 46 focused tests, types and lint passed | 39db81b0d5beb5fda00d0dccc24a9ec22d930879a70909695f9737680dad907b |
| goal-tui-registry-full-gate | All gates passed in 862.235s; 10,698 tests passed, six skipped | 321f556e091c94ba7670d4912e0f6e30d5cd400a8889c53ffcffc876799e6801 |
| goal-tui-registry-final-live | Final real-registry start/status/resume repeat passed in 2.872s | 81f05d9fa6570f606670ede30754a6d584b3a77a3683f76f922bc175e8bd7489 |

Isolated Codex review reproduced a working-directory regression in the initial
change. Capturing and forwarding the directory fixes it. Packet SHA-256:
`7bc88a92c3e56923c59d146a4e68854e491360bb30788134806fbc9bda87623c`.
Review log SHA-256:
`6bf0dbb635442f837cb4146c0072c71abe1e0640692e490f8525361ac666e418`.
Its conditional schema concern was refuted: the physical plan-step route is not
the Cesar delegation-tool schema. The real route accepts CLI values and the Goal
owner normalizes them. A test uses default host services, real Git worktrees and
ModStateStore for dry-run start, status and resume. This is source-level routing
with rebuilt package dependencies, not a rendered terminal or packed-install test.

Other controls cover quoting, escaping, aliases, end-of-options, negative flags,
disabled Goal, stale generation, queued cancellation and physical failure output.
The first focused run failed on eager test-catalog initialization; a later run
passed tests but failed a string-default type narrowing. Both failed receipts
are retained. Final mode-document regeneration produced no change.

All test receipts record zero providers. Review authentication copy removal was
verified; no second review is claimed. Logs remain in
`/Users/ra/dev/modular-agon-remediation/`. No global install or push occurred.
Historical Goal adoption and full clean-subject release acceptance remain open.

## Supervised startup and checkpoint identity

Date: 2026-10-19. Explicit resume now refuses missing state even when the caller
supplies intent and gate. A fresh supervised launch starts without `--resume`;
subsequent restarts resume its checkpoint. Existing-goal collisions stop before
supervision. Acquisition-time state changes are terminal, not automatic retries.
A stable `supervisorRunId` binds automatic recovery to the checkpoint created by
that supervised launch. It is a correlation marker, not a credential or sandbox.
Manual explicit resume without the marker remains supported.

Crash before the first checkpoint stops at the next resume. It does not recreate
unknown history. Crash after a checkpoint retains saved progress and costs.
Tests cover both competing-checkpoint interleavings: creation during acquisition
and a competing record after an early crash. Neither can adopt the other run.
The exact optional CLI field is tested alongside all existing argument contracts.

| Receipt | Result | Log SHA-256 |
|---|---|---|
| goal-explicit-resume-missing-red | Missing-state resume incorrectly created a goal | bd27229fc8a905a761ef3435200192a1cd2b340ab628d177296ee9193fb29fe7 |
| goal-supervisor-startup-recovery-red | Four startup/recovery controls failed | 46a664e20f372263fca842ea46c8a6ef0ef1ddcdfb2403eab14736caf075a270 |
| goal-supervisor-competing-checkpoint-red | Both review race controls failed | a9c0b753ecfc88d1c58bfb1bd7da05d339a11bd931e83e5ff23d81528d981144 |
| goal-supervisor-checkpoint-identity-full-gate | Failed: three fixture/contract expectations; 10,676 passed, six skipped | 410be8364ff2b644ffd24e05f49fd6e76f5837c16ef88f2e8ca075465a82087b |
| goal-supervisor-checkpoint-contracts | 58 focused tests, types and lint passed | 2f715352f85002951594e245c110174c3e4fe2d44bac3d57eeef3dc8df02e1ae |
| goal-supervisor-checkpoint-identity-final-gate | Full gate passed in 940.522s; 10,679 tests passed, six skipped | 2e1b854dd7b6c03787b97911c973d162f3f0f1529e979064a6fe2c92cac5231a |
| goal-supervisor-checkpoint-final-built | Seven CLI invocations plus a real supervised child passed in 2.41s | a89f93c6ba9936fcddcd0118027fc78850d28bb2a0d0b4171694e49e1b03f7f1 |

Isolated Codex review identified the competing-checkpoint defect; both local red
controls confirmed it. Packet SHA-256:
`af888d8ba295ab6a56821b83f53cc113ddd428856769569dffe7ff6b74970896`.
Review log SHA-256:
`7ad153410b3b05f4d608a26e58830f425254523075dd99f1a9be739c719f0434`.
The finding was fixed and verified locally; no second review is claimed.
The temporary authentication copy was removed after the review.

The first full run exposed three stale expectations: an error-path fixture reused
an existing goal ID, CLI parity lacked the exact new marker contract, and a nested
dispatch test expected resume on the initial launch. Distinct fixture IDs and
explicit field/argument assertions correct those expectations without exclusions.
All failed receipts remain available. Mode documentation regeneration produced
no change. Two built-CLI probe runs passed, including the final rebuilt candidate.

Raw commands, logs and receipts remain in
`/Users/ra/dev/modular-agon-remediation/`. Test receipts record zero providers.
No push or global installation occurred. These are development checks, not final
clean-subject release acceptance. TUI Goal routing, historical journal adoption
and the remaining original acceptance requirements are still open.

## Saved retry limits across resume

Date: 2026-10-19. Physical Goal previously discarded `maxAttempts` when saving
state. Resuming without an override silently used three attempts, even when the
original run selected one. Goal now stores the effective limit and restores it
on resume. An explicit override replaces the saved limit. Older modular records
without this field retain the existing default of three. Existing input clamping
to 1–20 is unchanged. Invalid saved limits fail before host effects or execution,
including when an explicit override or supervised mode is requested.

Twelve focused cases cover persistence, override persistence, old records,
malformed values, clamping and lowering a limit after attempts already occurred.
The original failure observed three dispatches instead of one. Five separate
built-CLI invocations verify fresh persistence, resume, override, repeated resume,
and corrupt-state rejection without changing the stored bytes.

| Receipt | Result | Log SHA-256 |
|---|---|---|
| goal-resume-attempt-limit-red | Original one-attempt regression failed | 504ff35939a7421601985dc74dbb0cde54f3a1973c5ea97c0b4e89cf0c662ded |
| goal-resume-attempt-limit-focused | Initial nine tests, types and lint passed | 2293635050a73a55d2f0f13d262126252328539bcdee619bead2a0762c0e3de8 |
| goal-resume-attempt-limit-review-controls | Twelve tests, types and lint passed | 9145bc398a77cf2be3f6e05620c4a1263eecef8d5b3298a32098c62f6972c083 |
| goal-resume-attempt-limit-full-gate | Full gate passed in 929.59s; 10,672 tests passed, six skipped | 9412885fe5b55f02434453c44d034364f81bde00fb1a29512d0ae33073a2cc27 |
| goal-resume-attempt-limit-built-cli | Five separate CLI invocations passed in 1.7s | 02eb5b82c06139ac07e89e89a1c9290e87f118b749db62291cec1da3db417585 |

Isolated Codex review found no blocking defect in the supplied source. Packet
SHA-256: `7e232a724746bbebf99d46b581377c4305651286d401cf792d00a67ff8065daf`.
Review log SHA-256: `4a4c523d9e15825a75ae4a1a8b325e57dd0c71cf891b6bda14c1371a37f86bc7`.
Its proposed corruption, explicit-override, lowering and clamping controls were
added and verified locally. The packet omitted the retry loop and supervisor;
the reviewer did not claim to verify those. Local behavioral tests and the full
suite cover them. No second review is claimed; temporary auth copy removed.

All test receipts record zero provider launches. Raw commands, logs and receipts
remain in `/Users/ra/dev/modular-agon-remediation/`. No global installation or
push occurred. This is development verification, not clean-subject release
acceptance. Legacy journal adoption and controller retirement remain unfinished.

## Historical Goal status reader

Date: 2026-10-19. The built modular CLI previously returned `No persisted goal`
for a valid legacy journal under `goals/<id>/journal.json`. Goal now reads that
journal through injected host effects when modern state is absent. It uses the
existing Goal journal owner and summary formatter; it creates no second store.
The result carries `format: legacy-journal`. Modern state retains precedence.

Ten status cases cover valid, absent, corrupt, malformed and wrong-ID records,
malformed tasks, unknown task statuses, revoked authority before/after read,
and modern-state precedence. Reads preserve bytes and do not initialize storage,
write modular state or dispatch engines. Existing summary/artifact checks also
pass. This fixes historical inspection, not historical execution migration.

| Receipt | Result | Log SHA-256 |
|---|---|---|
| goal-legacy-journal-status-probe | Built CLI reproduced missing historical status | 465cef464d62968ca5a745f71af3ca1e010f55555329924b6a6ed8b14a9c85a1 |
| goal-historical-status-red | Valid-journal regression failed before correction | 8fa5ca63b0fc9ea5ecc2db55a22830839e0cf1fa8face86e71613e388c1b474b |
| goal-historical-status-malformed-red | Reproduced malformed tasks reporting complete | de5269a7591b52191f4ecc508b6a695da98bdbda3adea07b80e2a0773faaff11 |
| goal-historical-status-final-focused | 16 tests, types, focused lint and diff check passed | 58ea7f0364f71ceda1216d84bcce9068ba5979ecd9cf56bcdbc3f659c22e41c4 |
| goal-historical-status-full-gate | All full gates passed; 10,660 tests, six skips; 951.933s | ea5769aa06b85c5a3ddc51b0e5b5128e66d39740a0ac1f98642ef97fce4117ff |
| goal-historical-status-final-built | Final built CLI read the intent and remaining task, preserving source bytes | 36d8a76c91d40eeb1acef4892aff7ad5c0797dba5481973b228311d746d2bf87 |

Isolated Codex review identified the malformed-task finding. Local red controls
confirmed it; the shared summary formatter now validates the fields used to
derive status. Packet SHA-256:
`abc6aed710d99fbf0c11cdaeabe1114f9569b146264f2c2abdcf4e4192f3c757`.
Review log SHA-256:
`0fa3d542b20856b26c11bf09ef229ade7a5819223d795ca9604a69045961ca3f`.
Its integration caveat is covered by the separate built-CLI probes. Its
precedence and post-read authority suggestions have explicit tests. The repair
was verified locally; no second review is claimed. Temporary auth copy removed.

An intermediate test failed because expected undefined properties do not
survive JSON serialization; expected state now comes from the persisted bytes.
That failed receipt, all review material and raw logs remain in the durable
evidence directory, `/Users/ra/dev/modular-agon-remediation/`. All test receipts
record zero providers. No global installation or push occurred.

Still required: lossless legacy resume, prior-writer quiescence, frozen-oracle
continuity, rollback/re-entry and legacy controller retirement. No release
acceptance claim follows from these development checks.

## Supervised invocation cancellation

Date: 2026-10-19. Supervised Goal now honors the invocation AbortSignal.
An already-cancelled invocation cannot spawn a child. Cancellation during state
loading prevents the later spawn; cancellation during execution sends SIGTERM
and waits for child close. Cancellation during backoff clears the timer and
prevents restart. The caller receives the original abort reason after cleanup.
No dependency or public runtime interface changed.

Real-child fixtures cover all four phases, exact child launch count, process
signal listener restoration, abort listener restoration and timer cleanup.
The initial backoff fixture incorrectly allowed zero retries; that failed run
is retained but is not evidence of a production defect. It now permits one.

| Receipt | Result | Log SHA-256 |
|---|---|---|
| goal-supervisor-invocation-cancel-red | Pre-abort spawned a child; active abort did not stop it | b17bb16165a2cec52c3ed2bb5422843750fe775a9f4f2552a3f1c084ca22cc6e |
| goal-supervisor-invocation-cancel-boundaries | Failed backoff fixture: no retries permitted | 3f218ea9576c680b9c0b02e2401241dd7758fe7cead0f1bc81e206a51b3ebff3 |
| goal-supervisor-invocation-cancel-reviewed | 15 focused tests, types, focused lint and diff check passed | ea63a46d2dbe56ac614481650b700a1418c0b0b16cf6904c0c9ebc46ec8d6c77 |
| goal-supervisor-invocation-cancel-full-gate | 10,650 passed, six skipped; all full gates passed in 945.115s | 7e65963b268db4e4b45e61a933f59d2c15c2e3b73882a8a66959ca69721e6804 |

Isolated Codex review found no introduced blocking defect. Packet SHA-256:
`8517ad4d2a79e2d7a72bf0844dc241ccae13a5fedda8817cee7877f229c5daa3`.
Review log SHA-256:
`cf889c609f6fb3db63c68379bcd198eb0809d56465a6fdc0e4be66d826be732e`.
Source-verified coverage suggestions added the state-loading cancellation,
launch-count and timer assertions, and accumulated output before matching the
readiness marker. Those test changes passed locally; no second review claimed.
Temporary review auth copy was removed. Test receipts record zero providers.

Limits: SIGTERM-resistant children, descendant-process teardown and the existing
spawn-error-before-close path require separate qualification. These tests do
not prove arbitrary child termination or legacy journal migration. This is
development verification, not a clean-checkout release acceptance receipt.
Durable raw evidence: `/Users/ra/dev/modular-agon-remediation/`.
No global installation, promotion or push occurred.

## Supervisor missing-queue parity

Date: 2026-10-19. The modular supervisor now treats Goal's `Queue not found`
diagnostic as permanent, matching legacy behavior. Previously it restarted the
same invalid invocation until the restart cap. No dependency or API changed.

The regression obtains the error from actual `runGoal`, then feeds it through
`runGoalSupervisor`. Before the fix it recorded two restarts; afterward it stops
with zero restarts, no wait, no engine dispatch and one runtime disposal. An
isolated built-CLI smoke test also starts the real supervised child and verifies
exit 1, zero restarts and the deterministic-failure reason within four seconds.

| Receipt | Result | Log SHA-256 |
|---|---|---|
| goal-supervisor-missing-queue-red | Reproduced two restarts instead of zero | 7936e0f2922add1b4c83307b945eaf85c30462e83b45a601bf5f99f31eeec4ef |
| goal-supervisor-missing-queue-green | 11 modular and 17 legacy tests, types and diff check passed | f1c183e2c5822bad6e7d9c0261be162b9949e237fa24584cb8e1f280cf33b3e2 |
| goal-supervisor-missing-queue-cli | One built-CLI smoke run passed; zero provider launches | 60eab7e6e4c0b50a5d66a3ea8ece6e49d6e05ca2abe4acd9f89e98e946b0263f |
| goal-supervisor-missing-queue-full-gate | Full gate passed in 951.978s; 10,646 passed, six skipped; zero provider launches | 132c1378d137321da9f787e6e871e23947a16505fb48b2ca70988c4e5971b182 |

Isolated Codex review found no blocking issue in this correction. Packet SHA-256:
`b97e5c0c293d16592f0654647a7a57394b5b97d056e7c1c81e85044b087dad02`.
Review log SHA-256:
`17cef27197c3c65065af168bae418b5df38187eedb42e6ceda930ed3bab7fcd3`.
Its coverage caveat was verified: the unit regression injects the child runtime;
the separate built-CLI smoke covers actual argument parsing and child output.
Substring classification still has its pre-existing heuristic limits. This does
not prove every supervisor cancellation path or clean-checkout release acceptance.
Evidence remains in the durable directory below. No global install or push.

## Goal review consensus parity

Date: 2026-10-19. Goal now uses Review's shared consensus policy. A verified
solo blocker or independently corroborated finding cannot be cleared by an
adjudicator. Only uncertain findings reach adjudication, with the task diff
and mutation evidence. Failed panels remain blocked. Retry diagnostics retain
the actual blocking reason.

The consensus module and raw findings extractor moved unchanged from CLI to
mod-review. Byte comparisons against `58d4ba5f3` confirmed both moves. Existing
CLI paths preserve imports through explicit re-exports. Raw parsing preserves
omitted-confidence inference and sparse findings before consensus; standalone
Review verdict behavior was not changed. No dependency was added.

Isolated Codex review `goal-consensus-policy` identified missing diff context,
lost raw finding information and misleading retry diagnostics. Each finding
was verified against source and corrected locally. The review preceded those
corrections; focused tests and the full gate verify the final bytes.
Review packet SHA-256:
`942d4b07c6f68111e144c1865febd2d2b472f19d4a10c09ff3ad7b651d5504ff`.
Review log SHA-256:
`0d538350058fff7d9d3b7df1ed88ffffc7ebc4e72efb2634cc10dfdc79d30e83`.
The temporary authentication copy was verified absent after review.

Logs and receipts remain in `/Users/ra/dev/modular-agon-remediation/`.

| Receipt | Result | Log SHA-256 |
|---|---|---|
| goal-verified-blocker-red-valid-roster | Reproduced forbidden adjudication of a verified blocker | da2225b11e2848f2331e385a40474a94f2b7b37ee97aa7595d58525db4c96a73 |
| goal-consensus-review-findings-red-selected | Eight cases executed; four reproduced review findings | fc5c27814a2e86144359c26d02b56b12f0c91383c0987e0fd6833bfc45e808e2 |
| goal-consensus-reviewed-controls | 134 tests and focused gates passed | ebab514aa773c71dd3b0b99fafa10ddd835d5daddd3869ce19a0bb3689b13137 |
| goal-consensus-retry-diagnostics | Ten retry/resume and diagnostic cases passed | 689f44292a2462213bbe5354f2fdd4efb446ae02d5b516619e51e686a3049d24 |
| goal-consensus-reviewed-full-gate | Failed one obsolete diagnostic assertion; 10,644 passed, six skipped | 25a4864610c1c709ef06c86c868933d8b74a3c14b4807c241939c4cf71de6d99 |
| goal-consensus-unavailable-panel-diagnostic | Ten cases, types, full lint and re-export guard passed | e0f284f93f98a4a9a50761878d600465c11a9d6d8a18b7ae2e8d4b49e7cde24d |
| goal-consensus-final-full-gate | Full gate passed in 902.794s; 10,645 passed, six skipped; zero provider launches | 5562d7d151cd4ad23058d44b12c86fa05833882743cd2c8ceeeb215e94da81f2 |

The failed full gate expected `review=1` instead of the actual unavailable-engine
reason. The corrected test checks that exact reason in both task state and the
event, while retaining fail-closed, no-extra-dispatch and zero-commit assertions.
The earlier `goal-verified-blocker-red` failed on an invalid fixture engine;
`goal-consensus-review-findings-red` selected zero tests. Both receipts remain
archived but do not count as negative evidence.

Full gate command:

```sh
npm run spec:modular-first-party:check && npm run spec:modular-generated:check && npm run build && node scripts/spec/verify-modular-release-set.mjs && node scripts/spec/verify-modular-supply-chain.mjs && npm run typecheck && npm test && npm run lint && npm run guard:reexports && npm run test:modular-release && npm run test:modular-supply-chain && git diff --check
```

Limits: this is working-tree development evidence, not clean-checkout release
acceptance. Legacy Goal ownership, supervisor parity, optional Think integration
and final subject-bound acceptance remain open. No global installation or push.

## Shared engine accounting follow-up

Date: 2026-10-19. CLI and MCP engine services now return the existing tracker's
cache-aware cost estimate and usage source when dispatch returns usage. Review
can consume those estimates on successful and failed calls. Missing usage stays
absent at the host; it is not recorded as measured zero. No price table or
dependency was added. TokenTracker rejects invalid counts and source values
before changing shared accounting.

Isolated Codex review `modular-dispatch-cost` identified malformed-usage
contamination and test-state leakage. Both were corrected and verified locally.
Review packet SHA-256:
`0c6f478dadbe8e229898b8a5c36d72f6dd3e38eba2eaf7955b1146bd6154b6e3`.
Review log SHA-256:
`5a515ee467eebfd21dcfbb9eb6c41184d7a2fb941ff3b786fce96de80e6a81f3`.
The temporary authentication copy was verified absent after review.

Receipts remain in the durable local directory named below:

| Receipt | Result | Log SHA-256 |
|---|---|---|
| token-tracker-invalid-usage-red-corrected | Seven missing-rejection failures before validation | 708198edcda28820f8f7f519fe175da90d8db40d80f7929ee54f03b4c0d8dcde |
| modular-dispatch-reviewed-host-controls | 130 tests, types, full lint and re-export guard passed | 5d9f1b05b8af714b70ecdd46cb104e8bd0ba0530ef60a3e8bf7db6af4611ff4b |
| modular-dispatch-reviewed-full-gate | Full gate passed in 832.038s; 10,636 tests passed, six skipped; zero provider launches | 789504c382a55b299db7fa35bdc18696f991acc7d013af4d64b6971ad09e3ae1 |

The earlier `token-tracker-invalid-usage-red` receipt is retained but rejected as
negative-control evidence: it failed from a missing test import, not the defect.
The corrected run above failed on the intended assertions. Host controls use
the real tracker and CLI/MCP services with adapter dispatch mocked. They cover
malformed usage, exact fallback cache pricing, coding-plan zero and Review
consumption. They do not establish live-provider billing accuracy.

Limits: `costSource` describes token provenance, not verified billing rates.
Unknown engines can use fallback prices. Review still maps absent usage to zero;
Goal's auxiliary accounting and Think parity remain unfinished. The full gate
tested working-tree source, not a clean committed release candidate. Native
platform and npm provenance cells remain separate. No global install or push.

Date: 2026-10-19. Development increment, not release acceptance.

Goal now calls the existing Forge workflow for competitor execution, synthesis
and oracle red-team probes. The approved internal dependency is
`@kernlang/agon-mod-forge@1.0.0`. The package graph has 49 packages and 156 unique
edges. No external dependency version changed.

The increment preserves explicit competitor rosters and uses existing routing
policy for default rosters. Repair attempts use the full roster. Returned
usage enters the existing cost ledger. Completed Forge runs can be recovered
after process death before Goal accounting, without charging them twice.
This does not establish recovery of every interrupted provider call.

## Verification receipts

Durable local logs and receipts are in
`/Users/ra/dev/modular-agon-remediation/`. Receipt names below omit `.receipt.json`.
The failed sandbox run is retained, not overwritten.

| Receipt | Result | Log SHA-256 |
|---|---|---|
| goal-forge-routing-full-qualified-environment | Full gate passed, 815.633s, 10,609 tests passed and six skipped, zero provider launches | b95243603d1291eae937e4f97778c6f030e3b24bcab99f09b8155ba44e6cc472 |
| goal-supervisor-reviewed-contract | Follow-up test changes: 56 tests, types, focused lint, diff check passed | 752b8d466452a9eef2b864031efffc57c7dc5333d12cb34985394c2aee15591e |
| goal-forge-final-roadmap | Roadmap and diff checks passed | bf5a42803a260abfdb40173a14cd38150ae59474ddd30bb3520eba6922ff627b |

Full gate command:

```sh
npm run spec:modular-first-party:check && npm run spec:modular-generated:check && npm run build && npm run typecheck && npm test && npm run lint && npm run guard:reexports && npm run test:modular-release && npm run test:modular-supply-chain && git diff --check
```

The gate ran in isolated state with provider/browser blockers and local
socket/watch permissions. The preceding sandbox run denied those operations.
Setup tests also found stale launcher inventory after rebuilding; regeneration
through the existing release-set generator corrected the inventory. Neither
daemon assertions nor package containment checks were weakened.

## Independent review

Isolated Codex reviews: `goal-oracle-recovery`, `forge-synthesis-accounting`,
`goal-default-routing`, and `goal-supervisor-contract-delta`. Raw packets,
reviews, adjudications and hashes remain in the durable local archive and
`goal-controller-parity-audit.md` there. Temporary authentication copies were
removed after review.

The last review confirmed that the exact `tasks` and `commit` CLI additions
repair supervisor input loss. Follow-ups assert that those names are absent in
the legacy baseline and feed actual supervisor argv through the generated Goal
route on both initial execution and restart. Existing real-worktree tests prove
default commits and explicit commit refusal. No broad extra-argument exemption
was introduced.

## Limits

The full gate tested working-tree source, not a clean committed release subject.
The follow-up changed only tests and roadmap prose. Fresh clean-checkout and
installed-candidate qualification remain required. Remaining work includes
mid-provider interruption recovery, artifact-write accounting, other auxiliary
provider accounting, legacy Goal owner retirement and subject-bound reviews.
Unavailable native runners and npm publishing provenance remain external cells.
The active/global installation was not changed. Nothing was pushed or promoted.

## API agent artifact-write follow-up

Both API agent methods previously threw after a completed model call when the
output file could not be written. The caller lost returned usage. Two real
filesystem EISDIR fixtures reproduced this. A shared private adapter method now
preserves usage and partial output in a failed result; cancellation and timeout
retain their exit codes and reasons.

Independent Codex review raised a health-classification risk. Six tests proved
that a path containing `unauthorized` could quarantine a healthy engine. Health
classification now receives the provider result before local write errors are
appended. Ten artifact-failure controls cover both methods, all terminal states,
existing provider fault flags, filesystem details and actual health state.

`api-artifact-reviewed-full-gate` passed in 831.591s: 10,619 tests passed, six
skipped; build/types/lint/generated/re-export/release-set/supply-chain checks
passed with zero provider launches. Log SHA-256:
`7363cc7a26a7d4b36c22e5c88bc6ae09882832283759699592a3091f10e8b1e5`.
Release metadata was regenerated after the build, before the full tests.

Independent review packet SHA-256:
`42b16ed0937bf9debbfdac55f1eb5f63e75270073cb960c60b2123bf699a256f`.
Review log SHA-256:
`f46b6e20168796ff4973ef20eebf35fbd02956ad21e99b32cb7ce2e55c99f738`.
Raw review, red/green controls and full-gate receipts remain in the same durable
archive. Temporary review authentication copy was removed. Other dispatch paths
and the shared Review/Goal cost contract still need qualification; this fix does
not establish complete accounting or release acceptance.
