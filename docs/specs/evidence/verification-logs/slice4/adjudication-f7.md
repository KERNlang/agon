# Slice 4 exact-subject review adjudication

Subject: `sha256:f7a94c449f40d61cfa4f54fd2f2a8081f5a7a5fddf3c842a179344952d2e0b81`

The two independent reviews and two-engine Tribunal ran against this exact
staged subject using only on-device Ollama engines. Raw outputs are retained
verbatim. Every model claim below was checked against the staged source and
executable gates; model confidence or a Tribunal verdict was not treated as an
oracle.

## Resolved findings

- The original S4 rollback sentence proposed repointing adapters to legacy
  implementations that had physically moved. The roadmap now states the real
  rollback boundary: restore the retained qualified S3 subject because S4
  never becomes runtime-authoritative.
- The first rollback proof trusted that statement without reproducing history.
  `scripts/spec/verify-modular-support-rollback.mjs` now selects an ancestor
  only when it carries the exact qualified S3 receipt and contains no
  `packages/support-*` paths. It checks representative S3 implementations for
  residual S4 imports, checks S4 adapter re-entry, and rejects a missing
  retained subject. The clean qualifier materializes S3 and S4 as two commits,
  so this proof works independently from the developer worktree.
- The full-suite timing boundary exposed a scheduler-proxy assertion. The lock test now proves the original holder timestamp exceeded TTL, elapsed time reached TTL, and the newly published lock remains younger than TTL. Its 16 direct tests pass.
- Earlier real review findings removed mutable process-global capability
  injection, froze compatibility capabilities, added runtime-isolation tests,
  and changed the browser bridge public byte type from Node `Buffer` to
  `Uint8Array`.

## Refuted exact-subject claims

- `AgentDispatchResult`, `AgentStepResult`, `ChatSession`, `BrainEvent`,
  `WorkspaceSnapshot`, `DiscoveryResult`, `JudgeOutputEvent`, `ApiAgentResult`,
  `BrainstormResult`, and `Plan` each have exactly one ownership occurrence.
  `AgentEvent` names two distinct declarations at two source paths; ownership
  is deliberately per declaration occurrence, and neither record has two
  owners.
- The cited `packages/legacy/*`, `packages/mod-kernel/src/ownership/index.ts`,
  `modules/foo`, `libraries/bar`, `packages/sdk/support-db`,
  `scripts/verify-support.ts`, `scripts/perf/stepMetrics.js`,
  `tests/unit/ledger.spec.ts`, `tests/integration/rollback.test.ts`, and
  `verification-logs/slice4/rollback.md` do not exist.
- The S4 migration ledger has no `generatedAt` field. Generated timestamps are
  provenance only; no resolver, worktree, or lifecycle path consumes them for
  dependency order or synchronization.
- The performance gate records median, p95, maximum, and p95 budgets; it does
  not average the last ten invocations.
- The rollback verifier uses Git history, the exact S3 receipt hash, the S3
  tree, and file contents. It does not read a mutable `subjectSha` from the
  current inventory.
- N-2/N-1 compile compatibility and all eleven current runtime descriptors are
  executable in `verify-modular-support-api-compat.mjs`. Boundary checks reject
  private imports, mutable runtime configurators, invalid support dependencies,
  and duplicate kernel dependencies.
- `packages/cli/src/signals/runs-store.ts:49` occurs exactly once in the
  261-entry migration ledger. The invented `foo.png` and `test/s5.test.ts` do
  not exist.

- Final review claims about `AgentDispatchResult`, `TeamEloRecord`, `BatchVerdict`, and `SyntaxValidatorResult` are refuted by their single generated ownership occurrences. `AgentSession` and `FileSnapshot` each name two distinct declarations at distinct source paths, not one declaration with two owners.
- Final Tribunal claims about cross-host clock skew, a 2.3-second adjudication example, a 2023 ledger row, `elapsed=999ms`, and `s3::ownership::check()` are unsupported; those strings and records do not exist. The lock oracle runs on one host and one wall clock.

## Remaining findings

None locally actionable for S4. The 57 compatibility consumers intentionally
remain for physical first-party mod extraction and generated-surface cutover in
S5 and S6. Runtime lifecycle rollback after a generated cutover belongs to S6
and S7; S4's non-shipping rollback boundary is now executable and explicit.
