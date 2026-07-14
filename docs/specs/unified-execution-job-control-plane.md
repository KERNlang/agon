# Unified Execution and Job Control Plane

Status: implementation contract  
Target branch: `feat/unified-execution-job-control-plane`  
Compatibility target: additive minor release (`0.3.0`)

## Confirmed claims

- [C1] `EngineDefinition` already models execution metadata such as `effort`, `family`, `derivedFrom`, `cliModels`, and API context/timeout/retry fields, but `EngineDefinitionSchema` and `ApiConfigSchema` do not validate or retain all of them. Zod therefore removes valid configuration before the registry can use it. Evidence: `packages/core/src/kern/models/types.kern`, `packages/core/src/schemas/engine-schema.ts`.
- [C2] `CliEngineAdapter` exposes the stable public methods `dispatch`, `dispatchStream`, `dispatchAgent`, and `dispatchAgentStream`, but each method independently chooses among API, CLI, PTY, and companion execution. Some combinations are unavailable or report failures differently. Evidence: `packages/adapter-cli/src/kern/adapter.kern`.
- [C3] The current `JobManager` is an in-memory UI helper with create/complete/fail/cancel/list operations. It does not own an executable task, an abort signal, ordered per-job events, or an async result. Evidence: `packages/cli/src/kern/signals/job-manager.kern`, `packages/cli/src/kern/surfaces/app-submit.kern`.
- [C4] `BrainClient` already defines the stable session/turn control boundary, and `AgonServe` exposes authenticated loopback routes for sending turns, events, cancellation, approval, and answers. The job contract must compose with these boundaries rather than replace them. Evidence: `packages/core/src/kern/sessions/brain-client.kern`, `packages/cli/src/kern/bridge/agon-serve.kern`.
- [C5] All workspace packages currently share version `0.2.3`; KERN `4.5.0` is already adopted. Release automation, not a feature branch, is the supported publication path. Evidence: workspace package manifests and release scripts.

## Inferences

- [I1] A lossless engine schema is required before execution can be unified; otherwise a correct driver still receives incomplete configuration. Depends on [C1].
- [I2] A single internal driver can normalize selection, streaming, cancellation, failures, retries, and health while preserving the four public adapter methods. Depends on [C2].
- [I3] A reusable job service should wrap asynchronous work and expose ordered events/results/cancellation, while the existing `JobManager` API remains as a compatibility facade for the TUI. Depends on [C3], [C4].
- [I4] The public additions justify a minor version, but tagging/publishing before the dependency branch is merged would create an unreproducible release. Depends on [C5].

## Requirements

### R1 — Lossless engine configuration

- The runtime schema must retain every supported `EngineDefinition` and API field.
- Existing engine files remain valid without edits.
- New timeout/retry/context fields remain optional and config-tunable; no provider/model policy is hardcoded.
- Tests must prove round-trip retention and rejection of invalid values.

### R2 — Unified execution driver

- Add one internal selection and normalization layer for API, CLI, PTY, and companion execution.
- Keep the public `EngineAdapter` interface and the four existing adapter methods source-compatible.
- All modes must share cancellation semantics and a normalized terminal outcome: success, cancelled, unavailable, timeout, or execution failure.
- Streaming and non-streaming calls must use the same provider selection rules.
- Agent mode may add its loop above the driver, but must not create a separate provider-selection implementation.
- API failures must never be converted into exit code `0`; user-visible errors must remain truthful.
- Provider retry/timeout behavior must come from engine configuration with backwards-compatible defaults.

### R3 — Reusable job service

- Add a job service that owns job identity, lifecycle, `AbortController`, ordered bounded events, terminal result, and error.
- Lifecycle is monotonic: `queued -> running -> succeeded | failed | cancelled`.
- Cancellation is idempotent and observable before the task completes.
- Event sequence numbers are scoped to a job and replay supports a caller-provided cursor.
- Retention and event buffer limits are config-tunable.
- Keep `JobManager.create/complete/fail/cancel/get/list/running` compatible for current TUI callers while delegating lifecycle storage to the new service.

### R4 — CLI/API integration

- `AgonServe` gains additive authenticated job routes under `/v1/jobs`: submit, list/status, events, result, and cancel.
- Existing `/send`, `/events`, `/cancel`, `/approval`, and `/answer` behavior remains unchanged.
- Job submission must return the job id before execution completes.
- Events/results must be isolated by job id and unknown ids return a truthful not-found response.
- The CLI and any MCP-facing adapter must call the same service rather than spawning a parallel synchronous lifecycle.
- Public request/response types are exported from the appropriate package boundary.

### R5 — Safety and autonomy

- Normal authorized implementation work runs without repeated confirmation.
- Destructive, irreversible, privilege-expanding, credential, publication, and main-branch operations remain approval-gated.
- Cesar may recommend or select other orchestration modes when useful, but the control plane does not force Nero, Tribunal, Brainstorm, Forge, or any engine roster.

### R6 — Release preparation

- Prepare all workspace manifests and generated/runtime version surfaces for `0.3.0` in one release commit only after implementation review passes.
- Repair stale install-smoke expectations and verify `npm run install:cli` plus `agon --version` locally.
- Do not create a tag, publish packages, or push `main` from this feature branch.
- The release becomes eligible only after the prerequisite control-plane branch is merged and the exact release tree passes the full gate.

## Acceptance evidence

- Focused tests cover schema retention/validation, execution selection parity, cancellation, normalized failures, job lifecycle, event isolation/replay/bounds, and each new HTTP route.
- `npm run kern:compile`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run kern:review -- --changed` pass in that order where generated outputs can otherwise race.
- Each implementation phase receives a full-roster `agon review`; proven findings are fixed before its signed granular commit.
- Final install smoke reports the intended local version and exercises at least one CLI execution plus one asynchronous API job through terminal state.

## Non-goals

- Replacing `BrainClient` or changing its multi-client arbitration contract.
- Forcing all engines through API or all engines through CLI.
- Persisting jobs across process restarts in this minor release; the storage boundary should permit a later durable implementation.
- Publishing from an unmerged feature branch.

## Planned commits

1. `fix: preserve engine execution configuration`
2. `refactor: unify engine execution drivers`
3. `feat: add cancellable job control plane`
4. `feat: expose asynchronous job APIs`
5. `chore: prepare Agon 0.3.0 release`

