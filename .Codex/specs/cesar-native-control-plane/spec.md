# Cesar Native Agentic Control Plane — P0 through P2

**Status:** IMPLEMENTED LOCALLY — P0–P2 certification evidence recorded; not pushed  
**Date:** 2026-07-13  
**Branch:** `feat/cesar-native-control-plane`  
**Confidence:** 0.98

## Executive Summary

Cesar already has a capable coding model, native workspace tools, steering, approval policy, persistent sessions, and Agon orchestration tools. The screenshot failure is not primarily a model-quality problem. It is a control-plane problem: a cancelled or timed-out turn can remain alive long enough to emit stale output, tool execution ownership is inferred from shared mutable state, and the final recap infers success from response/file-touch heuristics rather than a settled task record.

The full P0–P2 train is implemented on the feature branch. The authority-surface gates were retained during implementation so each stage earned entry into the next:

1. **P0 — deterministic turn runtime:** implemented one active lease, one executor per tool call, correlation IDs, cancellation fencing, deduplicated permission/result delivery, and terminal-state truth. Its envelope is the exact forward-compatible shape persisted by P1.
2. **P1 — durable and fast runtime:** implemented append-only lifecycle records, safe recovery after interruption/restart, configurable engine latency profiles, abort-aware stream settlement, and concurrency based on declared tool safety.
3. **P2 — native Agon autonomy:** implemented voluntary bounded cognitive modes and execution workflows constrained by authority already granted by the user and enforced by deterministic policy.

The work remains KERN-first: new and modified runtime source is `.kern`; generated TypeScript is produced only by `npm run kern:compile`.

## Agon Council Review

- **VERIFIED:** A three-engine Council (`claude,codex,agy`) completed successfully at `/Users/nicolascukas/.agon/runs/council-1783951893521-9pgm73-cesar-control-plane-spec`.
- **VERIFIED:** The chairman recommendation was “approve P0 only,” with 78% confidence, conditioned on forward compatibility between the P0 lease model and the P1 ledger schema.
- **VERIFIED:** The Council required P1 to prove schema-versioned fail-closed recovery and required P2 to separate cognitive freedom from execution authority.
- **ACCEPTED:** Reframe the implementation gates by authority surface rather than treating P0–P2 as a monolithic approval.
- **ACCEPTED:** Define the durable envelope before P0 runtime changes so P0 does not create a second migration problem.
- **REJECTED:** Cryptographic session pinning. The current CLI trust boundary is a single local process; a monotonic fencing token plus producer identity addresses stale async producers without importing a Byzantine/distributed threat model.

## Local Implementation and Certification Evidence

- **VERIFIED:** The KERN-first implementation adds the shared turn protocol, Cesar turn runtime, durable control-plane ledger, safe scheduler, bounded first-chunk retry, task execution lease, native Council tool, structured tool terminal reasons, and settled-runtime recap behavior. Generated TypeScript was produced through the KERN compiler rather than edited as the source of truth.
- **VERIFIED:** The final local gate passed 183 KERN tests and 4,011 TypeScript tests with one intentional skip; typecheck and the production build also passed.
- **VERIFIED:** Mandatory multi-engine review iterations were run at:
  - `/Users/nicolascukas/.agon/runs/review-1783957623748-bb17ib`
  - `/Users/nicolascukas/.agon/runs/review-1783958454611-6hx823`
  - `/Users/nicolascukas/.agon/runs/review-1783959289546-e4socq`
  - `/Users/nicolascukas/.agon/runs/review-1783959854851-uedpsq`
  - `/Users/nicolascukas/.agon/runs/review-1783960428936-4o3h7w`
  - `/Users/nicolascukas/.agon/runs/review-1783961153594-s686sx`
- **VERIFIED:** The final post-correction review completed with all three engines successful, zero verified findings, at `/Users/nicolascukas/.agon/runs/review-1783968770460-ljige3`.
- **VERIFIED:** Review findings were used as implementation gates and drove follow-up fixes for Goal/Conquer plan-mode authority, task-target widening, correlated terminal events, stale-turn fencing, recap truth, and orchestration continuation behavior.
- **VERIFIED:** The branch remains local. No feature-branch or `main` push is part of this certification record.

## User Intent

- **VERIFIED:** Implement all three phases, not P0 alone (user: “can we not do p0-2 also all”).
- **VERIFIED:** Cesar must be able to use Agon as its own primary operating environment, not merely as a side-check for Codex or Claude Code.
- **VERIFIED:** Cesar is free to invoke Nero, Tribunal, Brainstorm, and other suitable modes; the harness must not force a particular cognitive workflow.
- **VERIFIED:** The desired result is smoother, faster, more powerful, and strong enough for daily CLI use.
- **VERIFIED:** The target interaction is Codex/Claude-style AUTO: a normal implementation request authorizes routine in-scope execution without repeated Yes prompts; confirmation is reserved for dangerous or important boundary crossings (user clarification, 2026-07-13).
- **ASSUMED:** “Free to choose” does not authorize bypassing workspace permissions, plan approval, explicit long-run authorization, engine deny lists, budgets, or merge/push safeguards.

## Authority-Surface Stage Gates

The full roadmap is retained, but advancing between stages is a machine-evidence decision rather than a calendar decision.

### Gate A — before P0 source changes

- Freeze the serializable `ControlPlaneEnvelopeV1` below.
- Write deterministic failing tests using controlled deferred promises and an injected clock; do not depend on reproducing a production race probabilistically.
- Prove every existing session adapter can carry the additive envelope without changing text-only consumers.

Failure to satisfy Gate A sends the work back to spec rework. It does not justify a shared-flag patch.

### Gate B — before P1 runtime enablement

- P0 regression suite rejects late emissions, duplicate terminals, duplicate permissions, and stale recaps.
- The P1 reducer test proves an open mutating call becomes `interrupted_needs_inspection`, never retryable.
- Schema-version negotiation fails closed on an unknown future version.

Failure to satisfy Gate B stops P1. P0 may remain as an independently useful runtime fence if its own gates pass.

### Gate C — before P2 execution-mode enablement

- A capability matrix test derives a scoped task execution lease from the user request, AUTO state, and current permission/plan state, never from router confidence or model preference.
- Bounded cognitive modes remain self-selectable.
- Workspace-changing orchestration cannot start from a conversational/read-only request.
- Routine work inside an authorized task lease completes without per-tool prompts.
- Important work requires at most one task/plan confirmation before in-scope execution continues uninterrupted.
- A dangerous action prompts only when it was not already explicitly authorized by the current request or approved plan.
- Goal/Conquer explicit-user gates remain byte-for-byte effective under voluntary mode selection.

Failure to satisfy Gate C leaves cognitive-mode freedom enabled and execution-mode expansion disabled.

## Current State and Root Cause

### Field evidence

- **VERIFIED:** The captured session recorded an API first-chunk idle timeout after 60 seconds with one chunk and zero text characters (`~/.agon/sessions/chat-1783950158227/events.ndjson`, sequence 102).
- **VERIFIED:** The turn was then interrupted, but a prior turn recap appeared after the next user message and reported `Completed · 0.0s · changes:none` (`~/.agon/sessions/chat-1783950158227/events.ndjson`, sequences 106–123).
- **VERIFIED:** The same session later contained duplicate permission/completion paths for related commands and concurrent build output that hit generated-file unlink races. These are control-plane symptoms, not evidence that GLM-5.2 cannot code.

### Code evidence

- **VERIFIED:** Cesar concurrency is controlled by shared `busy`, `busySince`, `abortSignal`, `turnId`, `queue`, and `hasNativeTools` fields. A 180-second watchdog can force-clear the shared busy flag while the older invocation still unwinds (`packages/cli/src/kern/cesar/brain.kern:337-382`, `packages/cli/src/kern/cesar/brain.kern:2818-2852`).
- **VERIFIED:** A streamed tool event is classified as native versus eager by reading the mutable shared `ctx.cesar.hasNativeTools`; when it is `false`, the harness can eagerly execute the tool (`packages/cli/src/kern/cesar/brain.kern:1006-1065`).
- **VERIFIED:** API sessions also execute structured tool calls through `config.onToolCall`; batches currently use `Promise.all` (`packages/core/src/kern/sessions/session-resume.kern:1508-1513`, `packages/core/src/kern/sessions/session-resume.kern:1965-2004`).
- **VERIFIED:** `PersistentSession.send` has no turn/generation contract, and `SessionChunk` has no required correlation envelope (`packages/core/src/kern/sessions/persistent-session.kern:8-48`).
- **VERIFIED:** Interrupt clears visible UI/permission/steering state immediately, but there is no durable fence that prevents the old producer from emitting after a newer turn owns the surface (`packages/cli/src/kern/surfaces/app-interrupt.kern:100-145`).
- **VERIFIED:** Recap emission occurs after `handleCesarBrain` returns without a current-generation check (`packages/cli/src/kern/signals/dispatch/cesar-router.kern:940-1027`).
- **VERIFIED:** Recap completion is derived from `responded !== false`; workspace changes are inferred from file-tracker touch deltas. The renderer calls every zero-change result `none (explored only)` (`packages/cli/src/kern/cesar/recap.kern:183-199`, `packages/cli/src/kern/blocks/engine.kern:232-243`).
- **VERIFIED:** API stream watchdog defaults are literal 60-second first-chunk and 90-second inter-chunk values, although per-engine overrides already exist in the engine API contract (`packages/core/src/kern/api/dispatch.kern:427-486`, `packages/core/src/kern/models/types.kern:92`).
- **VERIFIED:** Cesar’s system prompt grants orchestration autonomy, but fast-path logic hard-blocks Forge, Brainstorm, Tribunal, Campfire, Review, Delegate, QuickNero, and others in both the stream and native tool paths (`packages/cli/src/kern/cesar/brain.kern:674-714`, `packages/cli/src/kern/cesar/session.kern:593-605`).
- **VERIFIED:** Council is a supported CLI/REPL workflow, but there is no Council signal tool in `createCesarToolRegistry` (`packages/cli/src/kern/handlers/council.kern:1-131`, `packages/cli/src/kern/cesar/tools.kern:5-31`).
- **VERIFIED:** The append-only session event log already provides monotonic sequence numbers, buffering, replay, and rotation, but its payload is opaque and does not define turn/tool lifecycle recovery (`packages/core/src/kern/sessions/event-log.kern:1-75`).
- **VERIFIED:** `/auto` is already persistent and applies to ordinary non-command turns (`packages/cli/src/kern/surfaces/app-submit.kern:443-457`, `packages/cli/src/kern/surfaces/app-submit.kern:575-616`).
- **VERIFIED:** `permissionMode=smart` already auto-approves the orchestrator path after exploration/plan/deny/confidence gates, but approval behavior is distributed across session, native tool, MCP, and self-turn paths rather than driven by one task lease (`packages/cli/src/kern/cesar/session.kern:947-1065`, `packages/core/src/kern/tools/tool-bash.kern:70-128`, `packages/cli/src/kern/cesar/self-turn-approval.kern:168-230`).
- **VERIFIED:** Recap currently counts every `status=error` tool as failed and promotes consequential commands before distinguishing a policy skip; recovery only collapses the same tool+input, so a later equivalent successful verification can coexist with a red failure line (`packages/cli/src/kern/cesar/recap.kern:101-124`, `packages/cli/src/kern/cesar/recap.kern:286-359`).
- **VERIFIED:** A `confidence-update` carrying `null` becomes `0` because `Number(null)` is finite, producing the false `0% confidence` visible in the screenshot (`packages/cli/src/kern/cesar/recap.kern:133-136`).

## Invariants

These invariants are deterministic and may never be delegated to model judgment.

1. At most one foreground Cesar turn owns the interactive session at a time.
2. Every turn has an immutable `{sessionId, turnId, leaseEpoch}` identity.
3. Every tool attempt has a stable `{stepId, toolCallId}` identity.
4. Exactly one execution owner may claim a `toolCallId`.
5. A terminal tool result is accepted at most once.
6. A permission request is displayed/resolved at most once and is scoped to its turn/tool call.
7. After a turn is cancelled, superseded, timed out, or settled, it may not execute tools, mutate shared turn state, append transcript output, emit a recap, or resolve a newer prompt.
8. A recap may be emitted only from the terminal record of the current turn.
9. Restart recovery never silently replays a mutating tool. Unknown in-flight mutations become `interrupted/needs-inspection`.
10. Read-only concurrency is allowed only when every tool declares it safe. Mutations and non-concurrency-safe tools are serialized.
11. Routing and confidence may recommend a thinking mode but cannot force or forbid a bounded cognitive mode.
12. Explicit deny rules, safety floors, scoped task authority, long-run authorization, budgets, engine deny lists, and merge/push policy remain hard constraints; routine execution inside a valid AUTO task lease does not require repeated confirmation.

## P0 Contract — Deterministic Turn Runtime

### Forward-compatible envelope

P0 uses the same serializable envelope that P1 later writes to disk. It is not an in-memory-only object that P1 must reinterpret:

```text
ControlPlaneEnvelopeV1 {
  schemaVersion: 1,
  sessionId: string,
  turnId: string,
  leaseEpoch: number,
  attempt: number,
  producerId: string,
  stepId?: string,
  toolCallId?: string
}
```

- `leaseEpoch` is a session-local monotonic fencing token. A producer must match the active epoch to emit or claim work.
- `attempt` distinguishes a bounded retry within the same user turn.
- `producerId` distinguishes session, harness, and companion producers without using mutable capability state.
- P1 persists these fields unchanged and adds event sequence/state/payload; it does not invent a second identity model.
- No cryptographic token is required unless Agon later crosses into an untrusted multi-process writer boundary.

Allowed turn transitions are explicit and testable:

```text
created -> running
running -> cancelling | completed | failed | timed_out | superseded
cancelling -> cancelled | timed_out
terminal -> no transitions
```

Every rejected transition is diagnostic evidence and has no side effect.

### Turn lease

Introduce a small KERN `CesarTurnRuntime` module, kept below 500 lines, that owns:

- immutable turn identity and lease epoch;
- lifecycle: `created -> running -> cancelling -> completed|failed|cancelled|timed_out|superseded`;
- the turn-local abort controller;
- current executor declaration;
- tool-call claims and terminal-result deduplication;
- permission-request claims;
- emission fencing (`canEmit`/scoped dispatch);
- terminal evidence and remaining work.

The shared `CesarState` keeps only a reference to the active runtime. It no longer acts as the runtime itself.

### Execution ownership

Each `SessionChunk` tool event carries the envelope plus:

```text
stepId, toolCallId,
executionOwner: session | harness | companion,
status: proposed | running | completed | failed | cancelled
```

Rules:

- Structured API function calls are owned by `session`.
- XML/text fallback calls parsed by the harness are owned by `harness`.
- Companion/MCP completion files are owned by `companion`.
- Ownership is frozen per call and never inferred later from `ctx.cesar.hasNativeTools`.
- The runtime rejects a second owner or terminal result for the same `toolCallId` and records the duplicate as diagnostic evidence.

### Cancellation and supersession

- Interrupt transitions the active runtime to `cancelling`, aborts its producer, denies outstanding permissions, and waits for stream/generator settlement up to a configurable grace period.
- A new turn may start immediately after the old lease epoch is fenced; the old producer can continue unwinding privately but every emit/claim path rejects its epoch.
- The fixed 180-second force-clear becomes a configurable stale-turn policy and may only supersede through the runtime transition, never by mutating flags directly.
- Queued/steering messages retain their current documented semantics, but ownership is tied to the runtime identity.

### P0 acceptance criteria — implemented locally

- [x] Reproduce the screenshot sequence in a deterministic test: first-chunk timeout, interrupt, immediate new message.
- [x] The old turn emits no text, tool request, permission prompt, state mutation, or recap after the new lease epoch begins.
- [x] A structured native tool call executes once even if an XML marker or companion completion represents the same call.
- [x] Duplicate permission events resolve through one UI prompt and one ledger record.
- [x] Parallel same-name calls remain distinct through `toolCallId`.
- [x] Interrupt settles all pending tool calls with an explicit terminal state.
- [x] Existing steering FIFO and image behavior remains intact.
- [x] The exact P0 envelope round-trips through the proposed P1 event shape without field translation or identity loss.
- [x] Deterministic deferred-promise tests reproduce the race on every run; production timing is not the test oracle.

## P1 Contract — Durable, Smooth, and Fast Runtime

### Durable lifecycle ledger

Persist `ControlPlaneEnvelopeV1` unchanged and extend the event-log payload while preserving existing replay compatibility:

```text
ControlPlaneEnvelopeV1,
eventSeq, kind, state, owner?, timestamp, evidence?, redactedPayload?
```

The ledger records turn start/terminal transitions, execution claims, approval decisions, tool terminals, checkpoints, verification, and recap terminal evidence. Sensitive tool inputs continue to use the existing redaction rules.

Recovery behavior:

- Completed terminal records replay normally.
- An open turn after process death is reconciled to `interrupted`.
- A read-only proposed/running call may be marked retryable, but retry remains an explicit runtime decision with a new `attempt` value.
- A mutating call with no terminal record becomes exactly `interrupted_needs_inspection`; it is never replayed automatically and the user gets a concise inspection requirement.
- An unknown `schemaVersion` is not partially interpreted. Recovery fails closed and reports the unsupported version.
- `/harness-replay [turnId]` renders the authoritative lifecycle rather than merging loosely related files by time.

### Engine latency profiles

- Move all watchdog defaults into config/schema rather than introducing new literals in execution code.
- Preserve per-engine `api.firstChunkTimeoutMs` and `api.idleTimeoutMs` overrides.
- Add a configurable cancellation grace and stale-turn threshold.
- Record time-to-first-productive-event and inter-event gaps per engine/backend.
- Retry a first-chunk timeout only when no tool execution or external side effect occurred; otherwise fail closed with partial evidence.
- A retry gets a new attempt/step identity under the same user turn and is visible in the ledger.

### Safe scheduling

- Use tool metadata (`isReadOnly`, `isConcurrencySafe`) to group independent reads.
- Serialize edits, writes, Bash, orchestration handoffs, and any tool marked unsafe.
- Never run two build/compile commands against the same generated-output workspace concurrently.
- Preserve cancellation propagation into every scheduled unit.

### P1 acceptance criteria — implemented locally

- [x] Crash/restart replay marks an unfinished turn interrupted without repeating mutation.
- [x] Event sequence and correlation IDs are monotonic and stable across log rotation/reopen.
- [x] ZAI/GLM latency values are configurable and visible through diagnostics.
- [x] First-chunk retry occurs only before side effects and is bounded by config.
- [x] Read-only calls may run concurrently; unsafe calls run in deterministic order.
- [x] No concurrent KERN compile/build generated-output race is possible inside one Cesar turn.
- [x] `/doctor harness` and `/harness-replay` identify stale, duplicate, and rejected emissions.

## P2 Contract — Native Agon Autonomy

### Cognitive freedom versus execution authority

Cesar may freely select bounded cognitive modes because they do not grant workspace mutation authority:

- solo answer/read/inspect;
- QuickNero/Nero adversarial check;
- Tribunal;
- Brainstorm;
- Campfire;
- Council;
- read-only Review;
- read-only Delegate/consult.

Execution workflows are also available choices when the user request establishes a scoped task execution lease and deterministic permission/plan policy agrees:

- direct mutating tools such as Edit, Write, and Bash;
- Forge or scoped Forge;
- Pipeline;
- Agent/team Agent;
- Delegate in execution/agent mode.

Choosing a workflow never manufactures authority. The capability check runs after the model chooses and before dispatch. A request such as “fix this,” “implement this,” “build this,” or “pull, compile, and verify” creates routine execution authority for that task and workspace. Cesar must not ask again for every Edit, Write, Bash, Forge, Pipeline, Agent, or Delegate action that stays within that lease.

The router supplies evidence such as task kind, estimated breadth, tool reliability, engine availability, and cost. Its language is advisory: “consider” or “recommended,” never “must not call” for bounded cognitive workflows. Fast paths reduce default budgets and prompt overhead; they do not remove cognitive tools or bypass execution-authority checks.

Hard authority boundary:

- Goal and Conquer still require an explicit user request and a discriminating gate where required.
- Explicit deny rules and non-overridable dangerous-command floors win over AUTO.
- Mutating execution must remain inside the task lease workspace, intent, risk ceiling, budget, and external-effect scope.
- Review remains read-only unless the user asked to fix.
- Removed engines remain unavailable, even if Cesar requests them.

| Capability tier | Modes | Cesar may self-select? | Required authority |
|---|---|---|---|
| C0 | Solo answer/read/inspect | Yes | Current read policy |
| C1 | Nero, Tribunal, Brainstorm, Campfire, Council, read-only Review/consult | Yes | Bounded spend/roster policy; no workspace mutation |
| E1 | Direct mutation, Forge, Pipeline, Agent, execution Delegate | Yes, as a mode/tool choice | Active scoped task lease plus normal deny/safety floors; no per-tool confirmation |
| E2 | Goal, Conquer | No implicit launch | Explicit user request plus existing gate/budget/branch safeguards |

### AUTO task execution lease

AUTO is a task-level contract, not a global “allow everything” switch and not a per-tool approval loop. The lease is created from the current user request and contains config-tunable policy fields rather than execution-code literals:

```text
TaskExecutionLease {
  sessionId, turnId, leaseEpoch,
  intent,
  workspaceRoots,
  riskCeiling,
  budget,
  allowedExternalEffects,
  explicitlyAuthorizedActions,
  expiresAtTerminalState
}
```

Approval classes:

| Class | Examples | Interaction |
|---|---|---|
| Routine | In-workspace Read/Edit/Write/MultiEdit, non-dangerous Bash, format/lint/typecheck/test/build, scoped Forge/Pipeline/Agent/Delegate for an implementation request | Run automatically under AUTO; no repeated Yes prompts |
| Important | Auth/session/token changes, persistence or migrations, shared/public contracts, cross-repository changes, broad dependency changes, or another configured high-impact class | Ask once for the task/plan unless the user already approved that exact scope; then run the approved plan without per-tool prompts |
| Dangerous/external | Destructive data operations, privileged OS access, secrets/credentials, publish/release, push to protected branches, deploy, payment, or other configured irreversible/external effects | Ask immediately before the action only if the current request/approved plan did not explicitly authorize it |
| Prohibited | Existing deny rules, removed engines, workspace escape, and non-overridable dangerous-command floors | Deny; AUTO and user phrasing cannot silently bypass the floor |

User language is authorization evidence. If the current request says “commit and push,” “publish,” or “deploy,” the matching action is already authorized within the named scope and must not trigger a redundant confirmation. A materially different target, protected branch, environment, account, cost, or destructive effect is a boundary crossing and may require confirmation.

Important-task confirmation is one task/plan gate, not a stream of tool gates. After approval, only a newly discovered dangerous or out-of-scope action can interrupt execution.

### Missing mode surface

- Add a `Council` signal tool and route it through the existing council handler with the active usable roster.
- Include Council in delegation extraction, continuation-loop protection, observability, help/system prompt, and tests.
- Keep QuickNero inline because it is a bounded adversarial check rather than a full handoff.
- Do not add one bespoke tool per arbitrary CLI command. The native surface exposes supported, typed workflows only.

### Task truth and recap

The turn runtime, not touched-file heuristics, supplies terminal truth:

- `completed`: the requested terminal condition is met;
- `waiting`: user input/approval is required;
- `delegated`: a tracked job owns remaining work;
- `interrupted`, `timed_out`, `failed`, or `superseded`;
- `partial`: useful work exists but the terminal condition is not met.

Recap evidence separates:

- workspace effect: changed, unchanged, or unknown;
- repository effect: already current/pulled/branch state when observed;
- verification: compile/typecheck/tests/build with pass/fail/pending;
- delegation/job ID and state;
- remaining work or blocker.

`changes: none (explored only)` is removed because it incorrectly conflates successful verification, no-op repository updates, waiting, timeout, and failure.

### P2 acceptance criteria — implemented locally

- [x] Cesar can invoke QuickNero, Tribunal, Brainstorm, Campfire, Council, and read-only Review/consult without the user naming the mode first.
- [x] Cesar can choose Forge, Pipeline, Agent, or execution Delegate only when the request already authorizes implementation/mutation.
- [x] Fast-path classification never blocks a bounded cognitive workflow and never grants execution authority.
- [x] With AUTO enabled, “fix this and run the tests” completes ordinary in-workspace edits and verification without any permission prompt.
- [x] An important task produces at most one task/plan confirmation; approved in-scope tools do not prompt again.
- [x] An unauthorized dangerous/external action prompts once at the action boundary.
- [x] An explicitly requested dangerous/external action is not redundantly re-confirmed when its target and scope match the request.
- [x] Any change to target, protected branch, environment, account, cost, or destructive effect invalidates the matching authorization and is handled as a new boundary.
- [x] Routing remains visible as a recommendation and can be overruled by Cesar.
- [x] Goal/Conquer cannot start without the existing explicit-user authority contract.
- [x] Council uses all usable non-excluded engines and never includes removed engines.
- [x] Delegated results are absorbed once and do not recursively redispatch the same thinking mode.
- [x] Recap state and evidence are derived from the settled runtime record.
- [x] A no-diff compile/test turn is reported as `workspace: unchanged` plus verification evidence, not “explored only.”
- [x] Investigation/policy skips never render as red failures and never count as executed verification.
- [x] The final executed result for a verification label wins across equivalent command forms; an eventual pass removes earlier failure noise.
- [x] Missing confidence is omitted rather than rendered as `0%`.

## UI Contract

The user has confirmed the recap UI direction. The exact visual/state contract, including the new screenshot regressions, lives in [`recap-contract.md`](./recap-contract.md). The existing rail placement, border, controls, and five-row cap remain unchanged; the final recap becomes a compact authoritative Done/Partial/Waiting/Failed summary.

## Contract and Producer/Consumer Map

| Contract | Producer | Consumer | Compatibility |
|---|---|---|---|
| Turn identity/lifecycle | CLI turn runtime | brain, router, UI, event log | Additive, then replaces shared flags internally |
| Correlated `SessionChunk` | persistent-session implementations | Cesar brain runtime | Additive metadata; old consumers ignore unknown fields |
| Tool execution claim | turn runtime | session/harness/companion executors | New invariant, no user-facing API break |
| Permission identity | executor/turn runtime | output permission queue | Additive fields; resolver behavior preserved |
| Versioned lifecycle event | runtime/event-log tee | replay, doctor, recap | Existing opaque events remain replayable |
| Terminal turn record | turn runtime | recap/decision log | Replaces heuristic outcome only |
| Council signal | core tool registry | Cesar router/council handler | Additive tool |
| Advisory routing | routing context | Cesar model | Prompt/policy behavior change |

## Blast Radius

The exact implementation may shrink after tests expose a narrower seam, but no new hand-written source file may exceed 500 lines.

| Area | Planned source files |
|---|---|
| Shared protocol | `packages/core/src/kern/sessions/turn-protocol.kern`, `persistent-session.kern` |
| API stream/tool execution | `packages/core/src/kern/sessions/session-resume.kern`, `packages/core/src/kern/api/dispatch.kern` |
| Durable ledger | `packages/core/src/kern/sessions/event-log.kern`, CLI event-log/replay integration |
| Turn owner | new `packages/cli/src/kern/cesar/turn-runtime.kern` |
| Cesar integration | `brain.kern`, `session.kern`, `brain-helpers.kern`, `tools.kern` |
| Orchestration | `tool-orchestration.kern`, `cesar-router.kern`, council imports/continuation protection |
| Output contracts | `handler-types.kern`, `recap.kern`, permission queue/output source |
| UI | `blocks/engine.kern`, `surfaces/status.kern` |
| Config/diagnostics | `models/types.kern`, doctor/harness replay source |
| Tests | focused unit/integration tests under `tests/unit` and `tests/integration` |
| Generated output | regenerated by `npm run kern:compile`; never edited directly |

## Regression Risks and Guards

| Risk | Guard |
|---|---|
| Session implementations emit different tool shapes | Contract tests for API, companion, stream-json, ACP, PTY/XML fallback |
| Cancellation drops useful queued steering | Preserve current normal-end carryover and interrupt-drop tests |
| Deduplication merges legitimate same-name calls | Key by toolCallId, never tool name/input alone |
| Retry repeats a mutation | Retry gate requires zero claimed/executed side effects |
| Serial scheduler slows safe reads | Batch only tools explicitly marked read-only and concurrency-safe |
| Advisory routing causes mode overuse | Retain budgets, roster health, cost telemetry, and recursive-thinking protection |
| Council loops on continuation | Add Council to thinking-action one-shot protection |
| Free mode choice becomes unscoped mutation | Bind execution to the task lease and test it independently from routing/model confidence |
| AUTO still nags on every tool | Make approval task-scoped; assert zero routine prompts and one important-task prompt |
| AUTO silently expands dangerous authority | Match explicit authorization by action and target; prompt on any material boundary change |
| Ledger leaks secrets | Reuse redaction and add fixture tests for commands/edit bodies |
| UI noise | IDs hidden by default; no new panel; exact one-line additions only |

## Stage Kill-Switches

- Stop before P0 source changes if the deferred-promise fixture cannot reproduce stale emission deterministically or any session adapter cannot round-trip `ControlPlaneEnvelopeV1` additively.
- Disable or revert P0 if any old `leaseEpoch` can still execute a tool, resolve permission, append transcript, or emit recap after supersession.
- Stop P1 if an unknown schema version is partially interpreted or an unterminated mutating call is classified as retryable.
- Stop P2 execution-mode enablement if a conversational/read-only request can launch E1/E2 work, a routine AUTO task produces per-tool prompts, or delegated-result continuation recursively relaunches the same cognitive mode.
- Stop the entire train if satisfying a test requires weakening Goal/Conquer explicit authority, permission policy, engine removal, branch isolation, or merge/push gates.

## Verification and Certification

Implementation is complete only when all of the following pass:

1. `npm run kern:compile`
2. Focused turn-runtime, persistent-session, API timeout, permission, recap, routing, and Council tests
3. `npm run typecheck`
4. `npm test`
5. `npm run build`
6. `agon review -e claude,codex,agy` against the full diff, with all blocking findings fixed
7. Real GLM/ZAI smoke certification:
   - ordinary answer;
   - read/edit/verify turn;
   - parallel reads plus serialized mutation;
   - first-chunk timeout and recovery;
   - interrupt then immediate new prompt;
   - autonomous choice of at least Nero and one multi-engine mode;
   - delegated result absorption;
   - truthful no-diff recap.

No push occurs until the complete feature passes locally. No push to `main` occurs without explicit confirmation.

## Out of Scope

- Adding vision to ZAI/GLM. Vision routing may use another capable engine, but this release does not change the provider model.
- Bypassing permission, plan, budget, engine-removal, branch, merge, or push safeguards.
- Automatically starting Goal or Conquer from a vague request.
- Replacing the current TUI layout or building a new desktop UI.
- Shipping a full `agond` client/server daemon. The ledger/protocol must be daemon-ready, but this release hardens the existing process first.
- Rewriting every oversized legacy file. New logic is extracted so those files do not grow materially.

## Open Questions

None blocking. Timeout values, cancellation grace, stale-turn threshold, retry count, and diagnostic retention are configuration fields with documented defaults; implementation code does not embed policy literals.

## Corrections Log

| Original idea | Verified reality | Design correction |
|---|---|---|
| The 60-second timeout is the primary bug. | A timeout is recoverable; stale post-interrupt output and duplicate ownership make it damaging. | Fix turn/tool ownership before latency tuning. |
| Fast-path blocking keeps Cesar efficient. | It contradicts the stated autonomy contract and prevents useful self-escalation. | Fast path changes budgets/recommendations only. |
| `hasNativeTools` is enough to choose the executor. | It is shared mutable state read after streaming events arrive. | Freeze execution owner per correlated tool call. |
| A response plus zero touched files means “explored only.” | Pull/no-op, compile, tests, waiting, timeout, and delegation can all have zero touched files. | Derive recap from terminal state and evidence. |
| Existing event replay is durable task recovery. | The payload is opaque and cannot safely decide whether an in-flight mutation ran. | Add versioned lifecycle events and fail-closed recovery. |

## Deploy Order

1. Complete Gate A and land P0 protocol/runtime plus compatibility adapters behind an internal feature flag enabled in tests.
2. Enable P0 by default only after stale-emission tests and P1-envelope forward-compatibility tests pass.
3. Complete Gate B, then land P1 ledger, recovery, scheduler, configurable latency, doctor/replay updates.
4. Complete Gate C, then land P2 cognitive autonomy, execution-authority matrix, Council tool, terminal truth, and confirmed UI changes.
5. Run the full local gate, mandatory Agon review, and real GLM/ZAI certification.
6. Create granular local commits with the required Agon KERN authorship/signature, then push the feature branch once.
