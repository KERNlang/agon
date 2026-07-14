# Guarded Implementation Plan

**Status:** IMPLEMENTED LOCALLY — P0–P2 delivered and locally certified; not pushed  
**Spec:** `./spec.md`  
**Confidence:** 0.98

## Execution Record

The user approved the full P0–P2 implementation. The authority-surface gates remained active during execution:

1. **Gate A passed:** the exact envelope is shared by the in-memory runtime, session adapters, and durable ledger.
2. **Gate B passed:** stale emissions are fenced, unknown schemas fail closed, and unfinished mutations recover as inspection-required rather than replaying.
3. **Gate C passed:** cognitive choice is advisory and free within budget, while execution remains bound to the independently tested AUTO task lease and dangerous-action boundary.
4. The full implementation remains on `feat/cesar-native-control-plane`; it has not been pushed.

This preserves the Agon Council correction without dropping any part of the user’s full roadmap.

## Phase 0 — Baseline and Failure Fixtures

1. Capture the screenshot failure as deterministic fixtures: late stream event after abort, duplicate representations of one tool call, repeated permission request, and stale recap.
2. Run the existing focused suites to establish the branch baseline.
3. Add tests first for every runtime behavior; a failing test must identify the missing invariant before source changes begin.

Checkpoint: compile plus focused tests. Stop if the baseline itself is red for unrelated reasons and classify that failure before editing.

## Phase 1 — Shared Correlation Protocol

1. Add `packages/core/src/kern/sessions/turn-protocol.kern` with the exact serializable `ControlPlaneEnvelopeV1`, transition reducer, identity validators, and stale-epoch predicate.
2. Extend `SessionSendOptions` and `SessionChunk.metadata` contracts in `persistent-session.kern` without breaking old consumers.
3. Update API/resume, companion, stream-json, ACP, and PTY session adapters one at a time to stamp or forward correlation metadata.
4. Add cross-adapter contract tests.
5. Round-trip the same envelope through a proposed P1 lifecycle-event fixture; no identity field translation is allowed.

Dependency: none.  
Primary risk: adapter behavior divergence.  
Checkpoint: `npm run kern:compile`, typecheck, persistent-session matrix, and Gate A forward-compatibility proof. Failure returns to the spec.

## Phase 2 — P0 Turn Runtime and Exactly-Once Execution

1. Add `packages/cli/src/kern/cesar/turn-runtime.kern` with lease, lifecycle, execution/permission claims, terminal dedupe, scoped dispatch, and evidence accumulation.
2. Change `CesarState` to reference the active runtime; preserve compatibility accessors temporarily for call sites migrated later in the phase.
3. Route brain/session tool events through the runtime and freeze `executionOwner` per call.
4. Remove executor decisions based on mutable `ctx.cesar.hasNativeTools`.
5. Scope recap, transcript, permission, and tool-result emissions to the active lease epoch.
6. Replace direct stuck-busy clearing with a `superseded` transition.
7. Make interrupt fence first, then abort/settle, then allow the next turn.
8. Use deferred-promise and injected-clock fixtures so stale completion/permission/recap races reproduce deterministically.

Dependencies: Phase 1.  
Primary risks: double terminal events, lost steering, companion compatibility.  
Checkpoints used: typecheck after every source file; focused tests after at most three files; full P0 failure-fixture suite before continuing. P1 advanced only after Gate B was explicitly satisfied by test evidence.

## Phase 3 — P1 Durable Recovery and Scheduling

1. Add versioned lifecycle envelopes to the event ledger while retaining opaque-event replay.
2. Record turn/tool/permission/checkpoint/verification terminal transitions through one ledger writer.
3. Reconcile unfinished turns to interrupted on startup; map an unknown mutating call to `interrupted_needs_inspection` and never replay it.
4. Upgrade `/harness-replay` and `/doctor harness` to display rejected duplicates, stale emissions, and recovery decisions.
5. Introduce config fields for first-chunk timeout, idle timeout, cancellation grace, stale-turn threshold, bounded retry count, and retention.
6. Add engine/backend timing observations and safe first-chunk retry.
7. Replace unconditional parallel tool batches with metadata-aware scheduling: safe reads parallel, unsafe calls serialized.

Dependencies: Phase 2 plus Gate B (P0 race suite green, known schema version, unknown-version fail-closed test, mutation no-replay reducer test).  
Primary risks: sensitive ledger payload, retry side effects, performance regression.  
Checkpoints: redaction tests, rotation/restart tests, scheduler tests, timeout tests, typecheck.

## Phase 4 — P2 Mode Freedom and Council

1. Extract compact advisory orchestration policy, task execution lease, risk classification, and deterministic capability-matrix modules rather than growing `brain.kern` or `session.kern`.
2. Remove fast-path hard blocks for bounded cognitive tools; retain small default budgets and route hints.
3. Add the typed Council signal tool and register it for Cesar.
4. Route Council through the existing handler, all usable non-excluded engines, result continuation, observability, and recursive-thinking guard.
5. Derive a scoped task lease from normal implementation language when AUTO is active; routine in-scope Edit/Write/Bash/Forge/Pipeline/Agent/Delegate calls consume that lease without per-tool prompts.
6. Route important tasks through one task/plan approval and then suppress redundant in-scope tool prompts.
7. Require just-in-time confirmation only for dangerous/out-of-scope effects not already explicit in the request or approved plan; preserve hard denies.
8. Keep Goal/Conquer explicit-user-only and enforce that deterministically before dispatch.
9. Update system/routing prompt language to state that recommendations are non-binding and AUTO owns completion inside the lease.
10. Test solo choice, voluntary cognitive escalation, routine zero-prompt execution, one-gate important execution, dangerous boundary confirmation, explicit authorization dedupe, mode override, roster exclusions, and long-run denial without explicit authority.

Dependencies: stable P0 ownership, P1 recovery, and Gate C capability-matrix/task-lease proof.  
Primary risks: recursive orchestration, excessive dispatch, authority expansion.  
Checkpoints: routing/tool tests and delegation continuation tests.

## Phase 5 — Task Truth and Confirmed UI Edit

1. Extend the recap event contract with terminal state, workspace/repo evidence, verification pending/pass/fail, job state, and remaining work.
2. Build recap only from the settled turn runtime.
3. Classify tool terminals as executed failure, policy skip, denied, cancelled, recovered, or success before building failure/verification rows.
4. Reconcile equivalent verification commands by logical label and final executed result, not exact command text alone.
5. Preserve null confidence as absent; never coerce it to `0%`.
6. Update `CesarRecapBlock` with the exact labels approved in `recap-contract.md`.
7. Feed authoritative turn phase into the existing `ExecutionRail`; keep the same border, placement, controls, and five-row cap.
8. Add the screenshot regression fixtures, renderer/state tests, and a terminal screenshot check.

Dependencies: user confirmation of the UI contract plus Phase 2 terminal truth.  
Primary risk: noisy or misleading status.  
Checkpoint: compile, typecheck, focused recap/status tests, and the visual pass/fail examples in `recap-contract.md`.


## Phase 6 — Full Certification and Ship-Ready Branch

1. Run `npm run kern:compile`.
2. Run all focused suites.
3. Run `npm run typecheck`.
4. Run `npm test`.
5. Run `npm run build`.
6. Run mandatory `agon review -e claude,codex,agy`; fix every verified blocker and repeat the affected gates.
7. Run the real GLM/ZAI certification matrix from the spec and preserve the run IDs/evidence.
8. Create granular local commits with required Agon authorship/footer.
9. Push the feature branch once only after the whole train passes. Do not push `main`.

## Planned Commit Boundaries

1. `feat(core): add correlated turn protocol`
2. `feat(cesar): enforce turn leases and exactly-once tools`
3. `feat(runtime): add durable recovery and safe scheduling`
4. `feat(cesar): make orchestration advisory and add council`
5. `feat(cli): report authoritative Cesar task state`
6. `test(cesar): certify native control-plane recovery`

Generated files are included with the source commit that produced them, not edited or committed as an independent hand-written change.

## Completion Gate

The user approved the reworked plan and UI contract, and the P0–P2 implementation passed the staged machine-evidence gates. The recorded full local gate passed 183 KERN tests and 3,983 TypeScript tests with one intentional skip, plus typecheck and production build. Mandatory review iterations are listed in `spec.md`. No push has occurred; pushing the feature branch or `main` remains outside this local completion record.
