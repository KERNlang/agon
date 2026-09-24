# S8 exact-subject source adjudication

Subject: `sha256:ba8c411f579e8bc055762c6f48d7facbf36aab68a4d8d6d6541a42629fbe567e`
Git tree: `c16dd34481439c4b0b5180e54e347f3382b2b6b1`

The final GLM/M3 Tribunal completed 2/2. The independent OpenCode source review covered predecessor tree `5d5f20e3380052182ddacb669ba76513b14af56a`; its one actionable service-boundary concern led to the only product changes between that review and the final subject. Codex then re-read every changed worker, authority, snapshot, registry, generation, surface, and test path on the exact final subject. A whole-diff local Qwopus review timed out at its hard 600-second limit and was not counted. An external whole-diff GLM review was blocked before dispatch because source disclosure lacked separate approval and was not bypassed.

## Resolved findings

1. **Worker-to-host call flood.** The host now caps each mod worker at 64 concurrent service calls and rejects excess work. `modular-s8-hardening.test.ts` proves the ceiling.
2. **Cancellation boundary.** Invocation cancellation is forwarded into mod code; engine capability calls receive the original host `AbortSignal`; the mod worker then fail-stops. Tests prove mod observation, host signal object identity, and later-call refusal.
3. **External output-stream collapse.** Command, intent, and plan-step `AsyncIterable` output now crosses the worker protocol as distinct text/progress/artifact/result events. A 256-event buffer ceiling fail-stops an abandoned producer. Tests prove event fidelity and overflow refusal.
4. **Receipt secret forms.** URL userinfo passwords and sensitive query parameters join bearer, environment-secret, encoded-secret, and keyed-field redaction. The receipt negative control verifies none survive.
5. **Portable identity collision.** Portable path keys normalize NFC before case folding. A filesystem-discriminating composed/decomposed collision test proves refusal where the host filesystem can represent both names.

## Refuted findings

1. **Resumable approval bypasses revocation.** Authority records are immutable historical decisions. `applyResumable` can only recover the same record ID and bytes; evaluation selects the greatest host-assigned sequence. An existing older approval cannot beat a later revocation. A fresh operator-approved record after revocation is an intentional new decision.
2. **Rollback selects unvalidated state.** `DurableModHost.validateGeneration` verifies the generation manifest, declared file set, lock and graph hashes, and the content hash of every file, including `installed-index.json` and `desired-state.json`, before rollback changes the pointer.
3. **Snapshot race accepts swapped bytes.** Before copying, a new inspection must equal the operator-approved candidate hashes. Each copied file is opened with `O_NOFOLLOW`, checked by device/inode/size, and read exactly. After copying, an independent snapshot inspection must equal the pre-copy hash. A swap before, during, or after copy fails one of those comparisons absent a SHA-256 collision.
4. **Signal identity lets a mod abort siblings.** An `AbortSignal` exposes observation methods, not `AbortController.abort()`. The signal is attached only inside the host-side engine capability call; it is not transferred into the worker. Worker mod code receives its own controller's signal. The regression proves the host dispatcher receives the exact original object without exposing its controller.
5. **Cryptographically unsigned same-user trust files are an S8 containment defect.** The published threat model is full-code consent, not an OS sandbox. Already-trusted code can directly use Node with the user's filesystem authority and therefore needs no trust-record forgery to run arbitrary code. Signing files with a same-user-accessible key would not add containment. Exact approval protects users from unapproved artifacts before execution; it does not constrain approved hostile code.
6. **Wildcard resource grant.** The code uses array membership, so `['*'].includes('specific-key')` is false. Action wrappers always check the concrete state key or engine ID.
7. **Unicode-confusable mod IDs.** Manifest mod IDs and contribution IDs are ASCII-only by schema. NFC/case normalization is additional filesystem portability defense, not the primary identifier validator.
8. **Performance budgets are unpinned.** The thresholds are executable constants in `measure-modular-slice8.mjs` and are repeated in the checked-in evidence.
9. **Early stream return must drain events.** Returning from an async iterator is explicit consumer abandonment. The host cancels and fail-stops the producer; it must not pretend later events were delivered. Normal iteration preserves every event.
10. **Service-limit failure rolls back earlier external side effects.** The limit is a concurrency and fail-stop boundary, not a transaction spanning arbitrary engine/network/state calls. Already completed capability actions remain completed and receipted; the excess call is denied. The documentation does not promise distributed rollback.

## Accepted, explicit limitations

- Executable folder mods receive full code trust; worker termination is a liveness boundary, not an OS sandbox.
- Direct subprocesses and OS resources opened by approved code cannot be guaranteed cleanly reaped by terminating a worker thread.
- Revocation applies before each new capability call and does not retroactively undo a side effect already completed.

## Exact-subject evidence

- 76 trust/runtime tests, 12 folder-mod tests, and 34 adversarial tests pass.
- The complete S7 installer/updater/fault/concurrency regression suite passes.
- The 47-control structural verifier and 31-check CLI lifecycle E2E pass.
- The public-API-only external example compiles, byte-matches committed output, rejects three private-import forms, installs from packed public dependencies, and imports.
- Workspace build, forced typecheck, lint, and modular pack checks pass.
- Ten-mod trusted bootstrap P95 is 638.6 ms under 750 ms; max RSS is 211,828,736 bytes under 268,435,456.

No locally actionable S8 finding remains after this adjudication.
