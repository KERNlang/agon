# Modular Agon Slice S2 — durable host implementation

## Status and authority

Slice S2 adds a non-shipping durable modular host behind the existing legacy
runtime. The legacy runtime remains authoritative; no active/global Agon
installation, personal configuration, credentials, histories, ratings, rooms,
goals, caches, or buddy engines are read or changed by this implementation.

The host is deliberately smaller than the later installer and profile system.
It owns durable generations, transaction recovery, generation leases, staged
migrations, rollback, safe-mode selection, disposal, diagnostics, and receipts.
S3 and later own profile UX, physical package extraction, generated-surface
cutover, third-party trust, and distribution.

## Durable layout

```text
host-root/
  current-generation.json     canonical commit-point pointer
  desired-state.json          snapshot for the selected generation
  installed-index.json        snapshot for the selected generation
  generations/                immutable, content-addressed generation trees
  staging/                    same-filesystem transaction staging
  transactions/               strict, mutable recovery journals
  receipts/                   exclusive-create, read-only terminal evidence
  leases/                     process-owned generation reference records
  locks/writer.json           one writer fence for every durable mutation
```

Every generation contains the canonical lock, desired-state snapshot,
installed-index snapshot, declared payload files, and a strict manifest. The
manifest binds the exact file set and every file hash. Unknown files, missing
files, unknown persisted fields, malformed hashes, invalid UUIDs, and invalid
timestamps fail closed.

## Commit and recovery contract

The pointer switch is the only commit point.

| Boundary | Durable observation | Recovery |
| --- | --- | --- |
| Before pointer | old pointer remains authoritative | remove staging/candidate and mark rolled back |
| Pointer selected, journal not final | candidate is authoritative | validate candidate, restore desired/index snapshots, finish journal |
| Journal final, snapshots incomplete | candidate is authoritative | restore both snapshots and finish the terminal step |
| Journal and snapshots final, receipt absent/corrupt | candidate remains authoritative | validate generation and synthesize separate recovered evidence |
| Current pointer/generation/journal corrupt | current is rejected | choose the newest verified prior generation, otherwise kernel-only |

Recovery holds the same exclusive writer fence as ordinary transactions. That
is intentional: recovery and mutation must never interleave. A stale writer is
reclaimed only by an explicit path that observes a dead PID twice around a
stable lock record. `ESRCH` is the only default proof of death; permission or
unexpected probe errors fail closed as possibly alive. A malformed lock is
preserved and Doctor reports the operator action instead of deleting it.

Receipts are evidence, not generation authority. Generation authority is the
strict pointer → journal → immutable manifest → canonical lock chain. Receipts
are outcome-suffixed, created with exclusive semantics, made read-only, bound to
the transaction/pointer/journal, and recursively redacted. Recovery reconciles
missing or malformed terminal evidence without overwriting the original bytes.

## Long-running hosts and jobs

- Every dispatch checks its loaded generation against the canonical pointer.
  A mismatch returns `MOD_RESTART_REQUIRED` before handler execution.
- Jobs acquire generation leases containing a UUID, PID, unguessable process
  identity, owner, and heartbeat. Only the owning process identity may heartbeat
  or release a live lease.
- Dead-lease recovery requires an explicit liveness oracle and a stable record.
  PID reuse therefore causes a safe retention leak, never lease takeover.
- Owners dispose in reverse dependency order and registrations dispose in
  reverse registration order. Timeouts or failures do not stop remaining
  cleanup and result in restart-required state.

S2 does not garbage-collect generations. Consequently, a lease cannot yet be
accidentally bypassed by deletion. Retention windows, quotas, and garbage
collection remain later lifecycle work and must consume this lease contract.

## Migrations and rollback

Versioned migrations operate only on a copied staging target. They require one
unambiguous, monotonically forward path, preserve and re-read the authoritative
source bytes, hash before and after state, and delete failed staged output.

Rollback validates the target generation while holding the writer fence, writes
a rollback journal, selects the verified target, restores its exact desired and
installed snapshots, then emits terminal evidence. A failure after pointer
selection is restart-required; boot recovery finishes the snapshots. Successful
rollback is stable across re-entry and is not replayed on every boot.

## Diagnostics and safety mode

Doctor reports health, selected generation and graph, recovery actions, typed
blocked reasons, and owner-attributed failures. Corrupt unrelated journals are
not executed; they degrade Doctor while a valid selected generation can still
boot. A malformed writer lock also leaves Doctor usable. Secret values and
credential-shaped keys are recursively copied and redacted before persistence;
structural UUIDs such as fence tokens retain their schema.

Safe mode never imports an unverified candidate. It deterministically searches
prior generation numbers in descending order and returns the first generation
whose exact manifest, lock, graph, and content hashes validate. If none exists,
the host returns kernel-only mode.

## Executable evidence

The S2 acceptance commands are:

```bash
npm run test:modular-host
npm run test:modular-crash-recovery
npm run test:modular-migration-engine
npm run test:modular-observability
node --expose-gc scripts/spec/measure-modular-slice2.mjs
```

The crash suite covers all nine named process-death boundaries, pre/post-commit
re-entry, snapshot convergence, missing/corrupt receipts, corrupt pointer,
journal, lock and generation artifacts, immutable receipt replacement, twelve
competing writers, ENOSPC, EACCES, EIO, torn writes, stale locks, PID reuse,
malformed leases, rollback, and kernel-only fallback. Frozen journal schemas and
strict negative controls reject plausible-but-invalid persisted state.

The final full-repository run also caught a pre-existing Slice S1B packaging
regression outside the durable-host boundary: the Claude model-probe parser fix
was present both as a development-only `patch-package` patch and as a Python
wrapper shipped by `@kernlang/agon`, but the TypeScript probe path invoked the
vendor script directly. A clean installation therefore dropped the selected
marker when Claude exposed duplicate aliases. The runtime now resolves the
packaged wrapper for Claude probes and falls back to the vendor script only when
the wrapper is genuinely absent. A discriminating test uses a fake Python
entrypoint whose current marker is true only when the wrapper is in the actual
spawn arguments; it failed before the wiring change and passes afterward.

Focused independent review also found two pre-existing hardening gaps in the
same probe module. Binary discovery and synchronous version lookup now use
argument-array process execution rather than shell interpolation, and a PTY
probe must exit successfully before any JSON is parsed or cached. Three
red-before/green-after negative controls cover those boundaries.

The complete repository suite passes with `AGON_HOME` and
`CLAUDE_CONFIG_DIR` rooted in disposable directories. The authenticated live
Claude cell is not rerun against personal credentials; its previously observed
duplicate-alias failure is covered locally by the wrapper-selection test.

Native macOS arm64 measurements are recorded in
[`evidence/modular-agon-slice2-performance.json`](./evidence/modular-agon-slice2-performance.json).
At the latest measurement, cold boot p95 and peak RSS remain inside the frozen
160 ms and 124 MiB release budgets. Linux and other native architecture cells
remain external release-qualification work and are not reported as passing.

## Rollback and removal

S2 is behavior-neutral until later cutover. Removing the S2 host exports and
files restores the S1B foundation because no legacy command dispatches through
this host. Once later slices adopt it, rollback selects the previous canonical
generation without uninstalling package bytes, followed by normal re-entry
qualification.
