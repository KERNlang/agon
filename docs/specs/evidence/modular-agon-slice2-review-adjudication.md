# Slice S2 adversarial review adjudication

## Review subjects

- Tribunal: local `ollama-direct-qwen` red-team plus local
  `ollama-direct-gpt-oss` chained verdict, disposable `HOME` and `AGON_HOME`.
- Independent review: local `ollama-direct-qwen` full uncommitted review.
- Independent retry: local `ollama-direct-gpt-oss` full uncommitted review with
  a larger disposable review-output budget. The first GPT-OSS attempt exhausted
  its output budget and is recorded as failed, never counted as passing.

Raw, repository-relative artifacts are stored under
[`verification-logs/slice2`](./verification-logs/slice2/).

## Fixed findings

| Source | Finding | Source verification | Resolution |
| --- | --- | --- | --- |
| Tribunal | Death after final journal but before receipt can leave no evidence | Valid in a narrower form: generation authority remained consistent, but the required receipt was absent | Added `after-final-journal`, immutable outcome-suffixed receipt creation, strict binding, malformed-receipt rejection, and recovery reconciliation tests |
| Independent Qwen | Malformed lease files escape as raw parser failures | Valid | Added strict lease schema parsing and typed `MOD_GENERATION_CORRUPT` containment for mutation and listing paths |
| Independent Qwen | Unexpected process-liveness probe errors can be treated as dead | Valid | Default liveness now treats only `ESRCH` as dead; `EPERM` and unknown errors fail closed as possibly alive, with a negative control |
| Full repository suite | Clean installs bypass the shippable Claude parser wrapper, losing the current marker for duplicate aliases | Valid; the wrapper existed but `refreshProbedCliModels` invoked the vendor script directly | Claude probes now resolve the packaged wrapper; a red-before/green-after spawn-argument test proves the wrapper is selected |
| Focused probe review | Shell interpolation in binary discovery and synchronous version lookup permits argument injection | Valid, pre-existing in the reviewed file | Replaced `execSync` interpolation with `execFileSync` argument arrays; two marker-file negative controls fail before and pass after the fix |
| Focused probe review | A nonzero PTY probe can cache plausible JSON written before failure | Valid | Nonzero exits are rejected before JSON parsing; a red-before/green-after test proves no cache is created |

## Evidence-refuted findings

| Claim | Adjudication |
| --- | --- |
| A committed generation must have a commit receipt before it may boot | Receipts are audit evidence, not generation authority. Authority is the strict pointer → committed journal → immutable manifest → canonical lock chain. Missing evidence is reconciled without invalidating valid committed bytes. |
| PID reuse permits lease takeover | The liveness check refuses reclaim while the numeric PID is alive, and heartbeat/release additionally require the unguessable stored process identity. PID reuse can retain bytes longer; it cannot transfer ownership. |
| Pointer SHA-256 length is not validated | `host-contracts.ts` requires `^sha256:[a-f0-9]{64}$`; substring and unknown-field corruption fail closed. |
| Rollback trusts an old receipt instead of the target manifest | Rollback validates the target’s exact immutable manifest and hashes under the writer fence. Receipts do not authorize generation content. |
| Redaction mutates caller data | `redactHostValue` recursively constructs arrays and objects and never mutates its input. Tests cover nested values and key redaction. |
| Recovery should use a second lock so ordinary transactions can continue | Recovery and transaction mutation must be mutually exclusive. Sharing the writer fence prevents precisely the mixed-state interleaving the contract forbids. |
| The reclaim marker is parsed as a writer-lock record | The marker is only an exclusive recovery mutex. The writer record is separately read twice from the writer-lock path. |
| Rollback writes a committed receipt before snapshot restoration | The receipt write occurs only after both snapshots and the committed journal write. Post-pointer failure throws restart-required and boot recovery finishes the snapshots. |
| Manifest parsing accepts `steps: null` | `steps` belongs to the journal parser, which explicitly requires an array before mapping it. The corrupt-journal test proves the failure. |
| `atomicWrite` ignores its mode | The passed `mode` is supplied directly to `writeFile`. |
| Lease UUID parsing rejects uppercase | The UUID expression is case-insensitive. |
| Lease records omit `createdAt` | Acquisition writes `createdAt` and `heartbeatAt` from the same clock observation. |
| Fence release leaves the record active | Release first asserts ownership, deletes and syncs the lock, then marks the in-memory fence released; later assertions fail immediately. |
| JSON property ordering compromises replay | Persisted contracts are parsed structurally and exact hashes use canonical JSON. Human-readable journals/receipts do not use byte ordering as authority. Object construction order is stable regardless. |
| Windows basename handling is an S2 blocker | Windows is explicitly deferred. S2 qualifies native macOS here and records Linux as an external release cell. |
| The wrapper candidates cannot resolve an installed sibling `@kernlang/agon` package | A synthetic installed layout places the executing module under `@kernlang/agon-core/dist` and the wrapper under sibling `@kernlang/agon/py`; the resolver returns the exact wrapper path. The CLI dry-run pack also contains `py/agon-model-probe-wrapper.py`. |
| The unit test imports a non-existent core facade | `packages/core/src/cli-models-registry.ts` exists and re-exports the probe surface. The focused and full repository tests compile and pass through that facade. |
| The timeout check occurs after the nonzero-exit check | The current source checks `result.timedOut` first, then `result.exitCode !== 0`. |
| The wrapper-selection test cannot reach the wrapper | The test failed before wrapper wiring and passes in the real monorepo layout; separate installed-layout evidence covers the sibling-package candidate. |
| Failed probes expose stale cached data | Reads reject cache files older than the TTL, and failure returns before any cache write. Retaining an expired file does not make it readable. |
| Candidate order is nondeterministic | Candidate precedence is a fixed array traversed in order: dev layout, installed sibling, then CLI bundle. |
| Recursive redaction mutates caller-owned values | `map` and `Object.fromEntries` construct a fresh graph. An explicit identity and deep-equality test proves the caller input remains equivalent and nested output identities differ. |

## Final disposition

Every locally actionable review finding was fixed and given a discriminating
test. The remaining claims above are contradicted by the cited control flow or
the frozen authority model. The successful full-diff GPT-OSS retry reported no
machine findings; its prose-only suggestions were source-checked and are covered
in the refutation table. A later focused review of the Claude probe delta found
two additional valid pre-existing hardening gaps; both were fixed with
red-before/green-after tests, and both engines' remaining claims were verified
against source and executable package-layout evidence. No locally actionable S2
review finding remains open.
