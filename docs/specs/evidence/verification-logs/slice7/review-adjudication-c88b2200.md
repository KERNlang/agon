# Modular Agon S7 review adjudication

External-review tree: `c88b2200ac209dbab52395e955154d033661aa12`

Final subject hash: `sha256:ee3c676a41accb052015680def6a707c4ef4be893d247dd0462a0825be54d5d5`

Host run: `host-run-20260831T084821Z-c88b2200ac20`

Adjudicator: Codex local source review

The host run executed the S7 test corpus, Agon Think, Brainstorm, Tribunal, and
an independent Agon review inside a disposable home. The Qwen review completed;
the GPT-OSS review exhausted its output budget. GPT-OSS nevertheless completed
an engine-distinct Tribunal red-team response, which is retained alongside the
Qwen review and checked here against the exact staged source.

## Qwen findings

1. **Timeout accepts zero — refuted.**
   `packages/mod-kernel/src/candidate-process.ts` rejects every timeout below
   one millisecond with `request.timeoutMs < 1`. Zero is below one. The suggested
   replacement `<= 0` is equivalent for integer inputs and therefore does not
   fix a defect.
2. **Missing rollback import — refuted.**
   `packages/mod-kernel/src/managed-lifecycle.ts` imports
   `rollbackGeneration` from `./host-rollback.js` and clean TypeScript
   compilation plus rollback tests passed.
3. **Executable is not realpathed — refuted as a blocker.**
   The bounded runner deliberately supports PATH-resolved executables such as
   `npm`, uses `spawn` with `shell: false`, rejects malformed arguments, bounds
   time and output, and supplies a canonical candidate working directory.
   Setup actions use a contained relative executable and verify its declared
   SHA-256 both during preview and immediately before execution. S7 activates
   first-party packages only; third-party activation has an explicit negative
   test and remains fail-closed until S8.
4. **Copied package bytes lack integrity verification — refuted.**
   `installVerifiedDirectory` reads each source file once, hashes the exact
   bytes and normalized relative path, writes those same bytes only into the
   candidate staging tree, and compares the final deterministic tree digest to
   `packagePlan.contentHash`. A mismatch throws before promotion and the
   transaction removes the staging tree. The contract is a tree hash, not an
   invented per-file hash list.
5. **Invalid generation should return null — refuted.**
   A missing pointer returns null. A present but corrupt generation must not be
   treated as an empty installation; `selectedInstallationId` intentionally
   lets validation fail closed and converts an invalid installation record to
   `MOD_SAFE_MODE`.
6. **Setup hash check has the wrong order — refuted.**
   Execution first binds approval to the exact plan hash, then re-hashes the
   executable immediately before invoking the bounded shell-free runner. The
   review incorrectly said the process may start before this check.
7. **Nested arrays remain mutable — refuted.**
   The local `freeze` walks `Object.values` recursively. Arrays are objects;
   their children are frozen before the array and parent are frozen.
8. **Recovery can observe a concurrently advanced generation — refuted.**
   Recovery acquires `locks/lifecycle-writer.json` before reading the selected
   generation and holds that same writer fence until journal repair completes.
   Apply and purge use the same lock path, so a lifecycle writer cannot advance
   the pointer during recovery.
9. **Duplicate script suppression — accepted as deliberate defense in depth.**
   `--ignore-scripts` and `npm_config_ignore_scripts=true` protect both the
   explicit invocation and inherited npm behavior. This is not a correctness
   defect.
10. **Environment guard accepts non-string values — refuted.**
    `NodeJS.ProcessEnv` values are strings or undefined. The truthiness guard
    blocks every non-empty managed installation identifier, and its positive
    and negative tests pass.

## GPT-OSS Tribunal findings

The GPT-OSS response is preserved because it is useful negative evidence, but
its purported source citations are predominantly invented. The staged files do
not contain `CandidateProcess.run`, `tempWrite`, `CLIServer.start`, direct writes
to `packages/mod-kernel/src/index.ts`, `npm pack` extraction into a live
`node_modules/@agon`, `support-persistence/cache/entrypoints.json`, snapshot
copies, or the claimed `npm-runlock.lock` protocol.

The actual S7 path uses:

- a unique transaction UUID and candidate staging prefix;
- a single-writer fenced lifecycle lock with stale-owner recovery;
- an immutable installation prefix promoted by rename only after verification;
- a durable transaction journal and receipts;
- a generation commit as the sole selection point;
- exact expected-base-generation conflict detection;
- lifecycle scripts disabled in arguments and environment;
- complete closure and deterministic lock validation;
- recovery, rollback, purge-preview, offline, corruption, concurrency, and
  fault-injection tests.

The Windows complaint is outside the frozen S7 platform scope, which is macOS
and Linux. Third-party registry trust is explicitly S8 and remains denied in
S7. The Tribunal’s final “Not logged in” synthesis failure does not invalidate
the two saved engine arguments; neither source argument identified a real S7
defect after local verification.

## Brainstorm and Think disposition

The Brainstorm response proposed Git checkpoints, a localhost registry, direct
repository rollback, and files that do not exist. Those mechanisms conflict
with the frozen architecture: immutable installation generations and atomic
generation selection, not mutation or Git restoration of the active checkout.
The Think output explicitly carried grounding warnings and was used only to
focus inspection on the promotion/selection boundary. Its three questions are
answered by the journal, deterministic replay/cleanup, generation validation,
and fault-injection corpus.

## Final disposition

All locally actionable claims were checked against the exact staged source.
No finding remains open. The one red clean-checkout result was caused solely by
the intentionally absent subject-bound review-evidence document; every clean
checkout command itself passed, including the 5,644-test repository suite and
the 160-workflow legacy oracle.
