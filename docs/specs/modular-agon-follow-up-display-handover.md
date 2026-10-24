# Follow-up display extraction and lost-tail fix

## Integration scope

- Branch: `refactor/modular-followup-display`.
- Worktree: `/Users/ra/dev/agon-display-refactor`.
- Base: `90fa66d73d6524469bf17e54a533524bb51bc0d8`.
- This is an isolated follow-up to the independent maintainability review's R1 finding.
- Claude's integration worktree, daemon diagnostics, and uncommitted cleanup fixes were not edited.
- No active/global Agon, personal state, provider process, or browser login was used.
- Candidate changes remain uncommitted in this worktree for Claude's review and
  integration. Nothing was pushed or merged into the shared implementation branch.

## Verified defect

The old `_fuEmit('', true)` returned early when the marker strippers emitted no
new text. That bypassed `_fuDisplayChunk`, even when its separate hold buffer
contained the entire answer or its last 24 characters. The final text sink then
skipped the answer because `_fuStreamedText` recorded the received text, not the
visible text. A short answer could therefore be persisted but never displayed.

The copied `makeFollowUpGate` test skipped that outer early return. Its passing
flush test did not test the production path.

Evidence from the isolated run directory `/tmp/agon-display-check-riXCLk`:

- `extraction-red.log`: the new exported-helper assertion failed before extraction.
- `extraction-green.log`: the extracted, unchanged emitter failed the real flush
  assertion: expected `Short answer.`, received no visible chunks.
- `caller-red.log`: ASK, fork, and confirmation each failed the new visible-output
  assertion while their persisted answer remained correct (three failures).
- `display-regression.log`: the same helper and real-brain assertions passed after
  allowing forced flushes through the empty-stripped-text guard (103 tests).

## Ownership and behavior

`packages/cli/src/cesar/follow-up-display.ts` owns the continuation's marker
strippers, tool-markup hold buffer, raw parser scan gate, and stream-end state.
It receives only chunk/end callbacks. It cannot send model requests or run tools.

The brain retains session-health policy, marker capture, completion de-duplication,
message persistence, tool execution, and orchestration. It supplies `flush: false`
after cleanup refusal, so held output remains hidden while an existing stream
still closes. The same marker-stripper state serves streamed and non-streamed
completion text.

The intentional behavior fix is the forced-flush guard. This is not a claim of
strictly unchanged display behavior. No tool parser, timeout, cleanup policy,
dependency, global installation, or daemon implementation changed.

## Tests and limits

- Production-helper tests cover short/long answers, empty streams, repeated end,
  later responses, refused flushes, shared marker state, split ASK/TODOS blocks,
  and XML/Mistral tool markup at every two-chunk split position.
- Existing ASK-resume tests now call the production helper instead of copied gate
  and teardown implementations. Cohere suppression exercises the full parser path.
- Real-brain assertions check visible output after all three question types.
- Caller wiring assertions remain for routing, capture, de-duplication, and finally
  ordering. This does not replace all source-text tests across the repository.
- The full-text parser cannot retract output already emitted before a non-XML
  tool call becomes recognizable. This extraction does not claim all textual
  formats are safe under every possible chunking pattern.
- This change does not resolve the separate daemon flake or certify the entire
  Modular Agon release. Re-run the integration branch's release evidence after merge.

## Claude integration notes

Review the helper, caller wiring, and visible-output regression first. Preserve
the separate `assertFollowUpHealthy()` additions in tool-loop send and
`onExchange`; this branch starts before those changes. Its four-line addition to
the existing cleanup-boundary test strengthens a healthy case and does not replace
Claude's extra tool-loop cases.

Run the focused tests, full repository gate, and the release/supply-chain checks
again on the combined branch. Do not copy this branch's older generated receipts
over newer integration evidence.

```sh
node node_modules/vitest/vitest.mjs run \
  tests/unit/cesar-follow-up-display.test.ts \
  tests/unit/cesar-ask-resume.test.ts \
  tests/unit/cesar-brain-cleanup-boundary.test.ts \
  tests/unit/cesar-confirmation-follow-up.test.ts
```

Use the project's isolated environment for these commands. Do not run provider
orchestration against personal state to validate this display-only change.

## Verification snapshot

These are local diagnostic runs, not release qualification receipts. Logs are in
`/tmp/agon-display-check-riXCLk`; the command wrapper uses the repository's
`pressure_modular.py` isolation helper, separate homes/caches/prefixes, and a
provider/browser launch guard. The guard is not an OS security sandbox.

| Check | Result | Log SHA-256 |
| --- | --- | --- |
| Baseline build | Pass | `decf4b48906939514e4119c600f668f29acce0f3534d4276807e2e72b5dfa330` |
| Baseline full suite | 6406 pass, 6 skip | `697a3f86cb423fb49fa37e70b7e57181a5cf3d6b1454f001f1a3f172f2a0a6ba` |
| Focused display/caller suite | 135 pass | `f0b110b46701d1564107e1e97f56b861e6667cfc4d39304317ed9d9e50d05fda` |
| Full build after extraction/fix | Pass | `387cd84f77c1a4f0b64744d8601a3e939c8ab7cb36b43feb5361c5f06921a87f` |
| CLI rebuild after unused-import cleanup | Pass | `ade2bb2b23f4a9ba09d5d0251d9caf8c2ff98437559f4aa13b5e8be30a3843b1` |
| Final typecheck | Pass | `be1cf12bc2c9d30c2cc1484ecb5ad9f709e037352543b5aeaf93337177ed2a06` |
| Final full suite, import-cleaned source | 6420 pass, 6 skip | `f1cc5cd1d4f7bc40a92ebcf9218279c9db4e4e26001c52227e2b458d726568c7` |
| Final lint | Pass, zero warnings | `2a77483e9f5e83cb3dddfd4280a7e863502e514d281439c684ed6dc57fb2e125` |
| Re-export guard | Pass | `de95be878ed3034819e11e168353c9f410a639a5c6304bc61e26718877a0291a` |
| First-party generator check | Pass | `d4f6d6eaaf2a06407d8bd6ade8c7c197929f5d19226bf328f7c2c82ef5d6a829` |
| CLI pack dry-run | Pass; one bundled display implementation | `903774cf1671e0f13dd836a03315ef99563670a97de0b64805ec59d08a55a275` |

The first final-lint run correctly failed on one unused import. It was removed;
no lint rule or exclusion changed. The first post-fix full run passed 6420 tests
(six existing skips). The second full run passed the same 6420 tests on the final
import-cleaned source. Neither pass closes Claude's separate intermittent daemon
investigation.

Final source hashes (SHA-256):

| Path | Hash |
| --- | --- |
| `packages/cli/src/cesar/brain.ts` | `715f0e737bfd437d7ae57f33b745cd8b7dac09ca14b97308e090c30f6e3d69c9` |
| `packages/cli/src/cesar/follow-up-display.ts` | `6b30c0a71aa97a1ebf823b6294082cc4c04a88832fc66f20b948006549e778e8` |
| `tests/unit/cesar-ask-resume.test.ts` | `f4547d47bbb62761a4ab9242f87f8a905fccfcc0e4899aec5ca30768eb2f760d` |
| `tests/unit/cesar-follow-up-display.test.ts` | `cc32ee6fef4fb0f1d4a146462dd5293254b20bd1f757073ac4df783b159b63f1` |
| `tests/unit/cesar-brain-cleanup-boundary.test.ts` | `a9618c08e75250015048ec0d8dd2db3be1a53becb7a264307157fe0fec50de0e` |
