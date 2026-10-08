# Brain cleanup-failure boundary: Claude return to Codex

Status date: 2026-10-06. Bounded safety fix. No release approval implied.
Not independently reviewed: Codex must review the diff, reproduce the tests,
and integrate explicitly.

## Subject

| Item | Value |
| --- | --- |
| Worktree | `/Users/ra/dev/agon-modular-claude` |
| Branch | `fix/modular-agon-claude-brain` |
| Base | `ddaf5577` (integration branch head at start) |
| Final commit | the commit that adds this note |
| Platform | macOS 26.1 arm64, Node v26.3.0 |

## Root cause (verified)

`packages/cli/src/cesar/brain.ts` checked cleanup health only at entry. Three
paths launched replacement work after a cleanup failure:

1. **Budget/acquisition awaits.** A failure marked during `enforceContextBudget`
   or `ensureCesarSession` reached the acquisition `catch`, which dispatched the
   adapter fallback, or the turn sent on a replacement session. The entry session
   could also be detached or replaced first, so a current-session-only check missed it.
2. **Compaction close.** `context-budget.ts` `doCompactReboot` swallowed a
   throwing `close()`, detached the session, and let acquisition boot a fresh one.
3. **Acquisition close.** Both `close()` calls in `ensureCesarSession`
   (`session.ts`) threw a raw error without marking. The brain then took the
   adapter fallback.

Observable effect: a provider launch beside a session whose cleanup failed, with
no restart warning. The router's outer guard cannot retract a launch made inside the brain.

## Fix

- `brain.ts`: capture the entry session. `refuseAfterCleanupFailure` checks the
  entry, current and acquired sessions after the budget gate, in the acquisition
  `catch`, and after acquisition. No await sits between the last guard and the
  first `session.send`, or between the `catch` guard and `adapter.dispatch`.
- `session-health.ts`: additive export `closeSessionOrMarkCleanupFailed`. It marks
  the session in the existing WeakSet, keeps it attached, and throws the existing message.
- `session.ts` and `context-budget.ts` route their closes through that helper.

A refusal returns `terminalState: 'failed'`, `decisionReason:
'session-cleanup-failed'`, one restart warning, and no persisted messages. The existing
`finally` clears busy/abort state and stops the spinner.

## Tests

New file `tests/unit/cesar-brain-cleanup-boundary.test.ts` (14 tests). The brain
is real. The budget gate and acquisition are deferred promises. Provider calls are spies.

- Red before the fix: 10 failed, 4 passed (the healthy controls). Failures showed
  a completed adapter fallback or a `self` turn that sent on the replacement.
- Green after the fix: 14/14.
- Cases: the gate resolves and rejects with the attached session failed; the entry
  session is detached or replaced, then failed; the acquisition resolves and rejects
  for {original, current}; a mismatched-session close fails; a compaction close fails.
- Healthy controls: CLI and API fallback after an ordinary acquisition error;
  replacement send after a healthy detachment; compaction detach after a healthy close.
- Mutation check: 7 mutants (each guard, each set member, each helper call site).
  All 7 were killed.

## Gates

Isolated with `scripts/spec/pressure_modular.py` `isolated_environment`, using a
private npm cache. Logs are in the session scratchpad and may disappear; the
hashes below are the durable record. These runs cover the working tree before
the commit, not a committed-source pressure receipt.

| Gate | Exit | Log SHA-256 |
| --- | --- | --- |
| build | 0 | `31429b4a8e3b17d3fe70f55b48d2c8f1804c31294392479ccd6b94bcdfb1c1d7` |
| typecheck | 0 | `be1cf12bc2c9d30c2cc1484ecb5ad9f709e037352543b5aeaf93337177ed2a06` |
| guard:reexports | 0 | `de95be878ed3034819e11e168353c9f410a639a5c6304bc61e26718877a0291a` |
| lint | 0 | `873a1b09804cbb869a9fb30f867293985793d8ded5870648977f7c7b810bcdbd` |
| release-set | 0 | `9f5d58f957725a11f7de74915e78eefd3a826865a36f7fd4cd036e3330025ba8` |
| supply-chain | 0 | `f44576629da0ad72e310722e282906311403f9bbe01720732c92896dad0709e0` |
| supply-chain --check --self-test | 0 | `f44576629da0ad72e310722e282906311403f9bbe01720732c92896dad0709e0` |
| test, long root (first run) | 1 | `d411a7d37043b61036a211d5633f2659d7c56b063b119410cc14c12667757726` |
| npx, unhydrated cache (first run) | 1 | `254c874ec704786ceaad57ac1ba72839253b7718b164fc7f1c31dc4f907aa440` |
| test, short root (rerun) | 0 | `0c6c1a28a37bb64bbefd6acc99f450bef3a9d261ec74d88b21a934d9b0424db9` |
| npx, hydrated cache (rerun) | 0 | `2114e82e9f54af521abe145d88146966910f788cf1a8e9099c82d3d465fa96d0` |

Final suite: 542 files passed, 6,309 tests passed, 5 existing skips (6,314).
The npx gate passed 72 installed-product checks.

Both first-run failures had environment causes (verified):

- `tests/integration/daemon-survival.test.ts` failed 3/3 when the isolated root sat
  under a long scratchpad path, and passed 3/3 under `/tmp/agd.*`. The socket
  path exceeded the macOS 104-byte `sun_path` limit (the AGON_HOME directory alone was 136
  bytes). The test reports only a readiness timeout. Product choice for Codex:
  make the daemon or test report an over-long socket path explicitly.
- npx: `ENOTCACHED` for `@ai-sdk/anthropic`. The cache was hydrated with public
  packages only (`npm install --ignore-scripts` of the packed release set into a temp prefix).

## Files changed

- `packages/cli/src/cesar/brain.ts`, `context-budget.ts`, `session-health.ts`, `session.ts`
- `tests/unit/cesar-brain-cleanup-boundary.test.ts` (new)
- Generated: `docs/specs/evidence/modular-agon-release-set.json` and
  `modular-agon-sbom.cdx.json`. Only the CLI tarball hash, integrity, and sizes changed.
  Regenerate both after integration rather than merging these values by hand.
- This note.

Integration ordering: no edit to `cesar-router.ts` or `cesar-recovery-cleanup.test.ts`.
This commit merges independently of Codex's router batch. The only shared surface is the additive
`session-health.ts` export.

## Findings

| Finding | Class |
| --- | --- |
| Budget/acquisition awaits bypassed cleanup refusal | verified, fixed |
| Compaction swallowed close failure and rebooted | verified, fixed |
| Acquisition close threw unmarked, then fell back | verified, fixed |
| A brain refusal reached through `routeWithCesar` likely warns twice (brain, then router `cleanupFailed()`) | inferred, not tested; router change is Codex's |
| The MCP-fingerprint close site uses the same helper but has no dedicated test | verified gap |
| Cleanup failure during later in-turn awaits (tool loop, continuations, follow-ups) | open; not covered |
| Provider termination after a failed close | open; the warning still says it may be running |
| Durable (cross-process) cleanup-failure state | open; the WeakSet is in-memory by design |
| In-flight adapter dispatch already launched before a failure | open; cannot be retracted |

## Safety confirmation

- No global install, link, or use of the active `agon`. No personal config,
  credentials, rooms, goals, or caches touched. No provider CLI, login, or browser launched.
- Dependencies were installed only in this worktree, with scripts disabled and empty npm configs.
- No push, no merge, no co-author trailer.

## Addendum (2026-10-08): follow-up commits and committed-source receipt

### `ab98be8f`: first-party generator drift (verified, pre-existing)

`spec:modular-first-party:check` failed identically on base `ddaf5577`
(`mod-plan/src/index.ts`, `mod-brainstorm/agon.mod.json`, `mod-brainstorm/src/index.ts`).
The checked-in packages had gained extracted workflow exports and kept
`engine.dispatch`. The generator still emitted the pre-extraction shape, so
regenerating would have deleted real exports. The generator now emits the
current exports. It also declares `engine.dispatch` for Brainstorm, whose seats
dispatch through host-supplied services that its source regex cannot see. The
historical Slice 5 receipt is left unchanged.

### `74026d2a`: tests launched real provider CLIs (verified)

A PATH shim recorded 21 real provider launches during the full suite:

- `tests/unit/cli-model-probe.test.ts`: `buildCliModelGroups()` ran
  `claude|codex|agy|opencode --version` through PATH 5 times
  (`packages/support-engine-catalog/src/cli-models-registry.ts` `getBinaryVersion`).
- `tests/integration/agy-probe-e2e.test.ts`: the codex live `/model` probe started
  the real codex TUI (`model_probe.py` `execvp`). Its guard checked the absolute
  `/opt/homebrew/bin/codex`. With a real HOME, the agy, claude and opencode probes can run too.

Fix: the unit test resolves every `ENGINE_PROVIDER_MAP` binary to a recording stub.
A new test asserts that only the stubs ran, and removing the PATH stub makes it fail.
Live probes now require `AGON_LIVE_PROVIDER_PROBES=1`. Suite behind blocking shims: 541 files passed, 1 skipped;
6,309 tests passed, 6 skipped; **0 provider launches**. Log
`sha256:d8421a8c9700a1e17369a51a84ca9ffcfac3918444300bd3baa5fff81ab186b6` (session scratchpad; not preserved).

Recommendation (product choice for Codex): `isolated_environment` inherits PATH.
Prepending a blocking provider-shim directory there would let every receipt prove
that no provider ran.

### Disclosure: provider launches by this session (verified)

Before the shims existed, this session ran three full suites (`HOME` isolated,
`PATH` inherited) and one mutant (real `HOME` and `PATH`). Each launched the real
provider `--version` probes. The three suites also each started the codex live probe once.
The codex install was unchanged afterwards (files dated 2026-09-13). The
Homebrew installs seen on 2026-10-06 were traced to two other Claude sessions
(`git-crypt`; `clamav`/`sevenzip`/`unar`/`xdelta`), not to this work.

### Committed-source pressure receipt (verified)

`python3 scripts/spec/pressure_modular.py --profile full --repeat 3` on
`ab98be8f` (tree `050bee6f`), run with blocking provider shims first in PATH:
**33/33 steps passed**. Receipt `/tmp/agon-pressure-qp7q6lgm/receipt.json`
(SHA-256 `a61f8199076934c8345c53f09a013029353a6bee9e159bbda396410fdd3f290b`). Archive
`sha256:559899048c1ba1a83be014ae93e0644c82e9f5528ddfaf490f44b5e39bb6d0d3`, runner
`sha256:0e1b1ca186b37a1b7281272c58237bbf4de6de49ca6755688b771122bbd41a28`, macOS 26.1
arm64. That run predates `74026d2a`, and its shim log recorded the 21 launches above,
all blocked. `74026d2a` changes tests only. A fresh receipt on the final commit is
still needed. Global-install snapshots (agon link, linked `dist`, `~/.agon`)
were identical before and after every run.
