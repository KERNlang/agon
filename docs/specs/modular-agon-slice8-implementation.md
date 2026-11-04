# Modular Agon Slice 8 — Trust, grants, and folder mods

## Status

Implementation is in qualification. This document does not authorize the active
or global Agon installation and does not claim an OS sandbox. The legacy runtime remains the rollback authority.

## Implemented boundary

- `$AGON_HOME/mods`-style discovery scans direct user-folder children only and
  imports no executable code during discovery. Package count, tree depth, file
  count, individual bytes, total bytes, and concurrent inspections are bounded. One invalid package is
  reported as an isolated diagnostic and cannot hide healthy siblings.
- Manifest JSON is size/depth/key bounded; duplicate and dangerous keys,
  traversal, absolute/URL/data entrypoints, symlinks, special files, nested
  archives, undeclared assets, collisions, and reserved first-party identities
  fail closed.
- Exact-artifact trust binds ID, version, source, canonical locator, manifest
  hash, content hash, publisher, and provenance. Explicit development-path trust
  is visibly distinct; changed bytes always invalidate trust, grants, and enablement.
- Trust and grant changes require exact plan-hash approval. They serialize on
  the same durable writer lock as graph changes, produce crash-recoverable journals,
  and retain immutable receipts. Trust/grant approval never enables code: exact
  activation has its own durable record and separately approved plan hash.
- Executable activation uses a separately copied, independently re-hashed,
  read-only snapshot to close the mutable-folder check/import race. Activation
  runs in a killable worker with separately bounded factory, activation, invocation, and disposal operations; it is owner-scoped, reversible, and forbidden in kernel-only safe mode. Invocation cancellation is propagated through `InvocationContext.signal`, including the original host signal used by engine-dispatch capabilities; after a bounded cooperative grace window the per-mod worker is fail-stopped and rejects later invocations until the host creates a new generation. Worker-to-host service calls have a fixed concurrency ceiling. Public command, intent, and plan-step output streams cross the worker boundary without collapsing text, progress, artifact, or result events; abandoned streams have a fixed buffer ceiling and fail-stop the worker. Worker crashes, aborts, floods, and timeouts remove partial registrations and cannot block the host event loop.
  Enabled external candidates pass the canonical resolver's kernel/API/Node,
  platform, semver, dependency, collision, conflict, cycle, reserved-ID,
  prerelease, yank, and source-precedence rules before import.
- The management backend exposes inspect, approval preview, exact approval,
  evaluation, activation, and cleanup. The grouped view exposes source, trust,
  permissions, blocked reason, and recovery text without relying on color.
- The external example at `docs/examples/hello-folder-mod` compiles against the
  public Mod API only and documents the complete package shape. A build-drift verifier packs the public API and its public dependencies, installs only those tarballs in an isolated temporary project, rejects static, re-exported, CommonJS, and computed dynamic private imports, recompiles the example, byte-compares committed `dist`, and loads the result.
- `agon mod list`, `inspect`, `trust`, `enable`, and `disable` expose the exact
  inspected identity and content hashes. Trust/enable and disable are two-phase:
  preview writes a 0600 plan, apply requires the exact displayed hashes, and any
  intervening byte change invalidates the plan. Built-in enable/disable operations use the same preview-bound durable generation transaction and do not import a mod being disabled. `agon mod recover <generation>` can restore an exact verified generation even when the current pointer is absent or malformed.
- `/mod` opens a grouped, keyboard-complete picker with textual status, dependency blocks, and recovery guidance; explicit `/mod ...` actions use the same management path. External TUI input is validated against the declared contribution schema before mod code runs. Trusted external CLI and
  TUI contributions join the same immutable owner-tagged generation as bundled
  contributions; no parallel dispatch table exists. External MCP and Cesar tools
  are projected from that generation and invoked through its pinned client.
  Disabled contributions disappear from all four executable surfaces after
  restart, and stale MCP/Cesar clients fail closed on generation change.
- `AGON_MOD_SAFE_MODE=1` boots the verified recovery generation when possible, exposes only kernel management surfaces, and excludes every external candidate before import. Trust and grant changes are re-read before every capability call, so revocation denies the next invocation in an existing host. Registry membership remains generation-pinned and activation changes report restart-required semantics.
- `agon doctor mods` performs read-only discovery and validates trust, grant, activation, and durable activation-failure records. Corruption and the latest unresolved failure remain visible with recovery guidance while execution fails closed.
- The final clean-checkout gate repeats ignored/untracked source contamination detection after every build and test, so late generated source cannot create a false-green receipt. S8 performance evidence measures 10-folder discovery over 40 observations
  (so P95 is not the maximum of an undersized sample), exact authority evaluation,
  trusted physical bootstrap, and peak RSS against explicit budgets.

## Trust statement

- External state is owner/content-hash scoped. State writes are atomic and size
  bounded; permission decisions and privileged actions generate immutable,
  redacted receipts. The host does not expose private compatibility machinery to
  external mods. Required lifecycle grants are derived from the manifest rather
  than trusted from a caller-supplied ID list.
Tier 2 executable folder mods run with full code trust. Production activation uses a worker as a hard termination boundary for factories, activation, invocation, and disposal, but that worker is not an OS sandbox and does not restrict filesystem or process authority.
Injected capability wrappers provide explicit intent, denial, and receipts for
cooperating code and create evidence; they do not prevent approved code from
using Node directly. Worker termination stops the mod’s JavaScript event loop; it cannot
guarantee cleanup of subprocesses or OS resources the fully trusted mod opened directly.
Only code the operator is willing to execute directly should be approved.

## Rollback and recovery

Before import, failures leave no registry owner. Partial registration rolls
back. Every reverse disposer is attempted; multiple cleanup failures are
reported together rather than hiding later cleanup. Authority
transactions interrupted before record creation recover as rolled back; a crash after an immutable record recovers as committed. External import, catalog, or activation failures are recorded durably with redacted cause and recovery guidance; a later success resolves the exact failed identity without erasing history. Safe mode imports no third-party
runtime. `agon doctor mods` reports malformed authority or activation state without
executing mod code or mutating recovery state. Disabling or removing a mod does not purge its data.

## Evidence commands

```bash
npm run test:modular-slice8
npm run spec:modular-slice8:self-test
npm run spec:modular-slice8:e2e
npm run perf:modular-slice8
node scripts/spec/verify-folder-mod-example-drift.mjs
npm run typecheck
npm run lint
npm audit --omit=dev
```

S8 is complete only after a clean committed-checkout qualifier, rollback and
re-entry replay, successful multi-engine Tribunal, and independent review are
recorded in content-hashed evidence. A degraded Tribunal is diagnostic only.
