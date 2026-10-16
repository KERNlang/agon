# Modular Agon runtime contract

**Status:** FROZEN V1 CONTRACT BASELINE
**Date:** 2026-08-20

---

## Purpose

This document defines the manifest, resolver, lockfile, registry, lifecycle, and
surface contracts for Modular Agon. It describes behavior, not final file names.
The executable schemas and TypeScript surface indexed in
[`modular-agon-contracts-and-evidence.md`](./modular-agon-contracts-and-evidence.md)
are normative. Illustrative prose must not override them.

## Manifest v2

The canonical package metadata is JSON so it can be discovered and validated
without importing executable code. Validation uses a strict runtime schema;
unknown fields are rejected in v1. A future schema may reserve an explicit
extension namespace, but implementations must not invent one.

The schema URL is an editor/documentation identifier, never a runtime network
dependency. The authoritative schema ships versioned and integrity-covered with
the public Mod API and kernel; releases record its hash and ownership. Offline
validation uses those local bytes.

Canonical shape (the generated Draft 2020-12 schema is authoritative):

```json
{
  "$schema": "https://kernlang.dev/schemas/agon/modular/v1/manifest.schema.json",
  "schemaVersion": 2,
  "id": "agon.think",
  "name": "Think",
  "version": "1.0.0",
  "apiRange": "^1.0.0",
  "execution": "executable",
  "compatibility": { "kernelRange": "^1.0.0", "nodeRange": ">=22 <27" },
  "packageClass": "user-toggleable-mod-package",
  "entrypoints": {
    "runtime": "dist/index.js",
    "types": "dist/index.d.ts"
  },
  "display": {
    "group": "work",
    "order": 20
  },
  "dependencies": {
    "required": [],
    "optional": [{ "id": "agon.goal", "range": "^1.0.0" }],
    "conflicts": []
  },
  "permissions": [
    { "capability": "engine.dispatch", "resources": ["configured-engines"], "required": true }
  ],
  "platforms": ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"],
  "assets": [],
  "contributes": {
    "cliCommands": [{ "id": "think", "aliases": [] }],
    "tuiActions": [{ "id": "think", "aliases": [] }],
    "mcpTools": [],
    "cesarTools": [{ "id": "Think", "aliases": [] }],
    "lifecycleHooks": [],
    "resultTypes": [{ "id": "agon.think.result.v1", "aliases": [] }],
    "configKeys": [],
    "generatedDocs": [{ "id": "mode.think", "aliases": [] }]
  },
  "pack": { "include": ["dist/index.js", "dist/index.d.ts", "agon.mod.json"], "executable": [] }
}
```

### Identifier rules

- Canonical mod IDs are lowercase ASCII dotted/dashed IDs and globally unique;
  npm package names are separate package-map metadata.
- Public contribution IDs are stable lowercase identifiers scoped by kind.
- CLI/slash aliases are redirects owned by the same mod or a declared migration.
- Kernel-reserved IDs cannot be contributed or overridden.
- An alias cannot satisfy `dependencies.required` and cannot shadow another canonical ID.
- Duplicate canonical IDs are fatal; load order never decides ownership.

### Paths

- Manifest entrypoints and referenced files are relative, normalized paths.
- Absolute paths, `..` traversal, URL imports, and symlink escape are rejected.
- The loader resolves the package root and target through `realpath`, then proves
  target containment before read/import.
- Integrity is verified before any executable entrypoint is imported.
- A declarative-only manifest sets `execution: "declarative"`, omits
  `entrypoints`, requests no permissions, and contains no executable pack entry
  or asset. It may contribute only kernel-validated config metadata and generated
  documentation; CLI/TUI/MCP/Cesar handlers, lifecycle hooks, and executable
  result renderers are forbidden. Any handler reference makes it executable.
- `compatibility.kernelRange`, `compatibility.nodeRange`, and `apiRange` are
  valid semver ranges checked before selection. Every static/native/schema/docs
  asset declares its path, kind, media type, content hash, byte count, platforms,
  executable bit, and optional consuming contribution.

## Dependency model

### Hard dependencies

`dependencies.required` contains canonical mod ID plus semver range. Every hard dependency
must be installed, compatible, granted, available, and selected for the dependent
to activate.

### Optional dependencies

Optional integrations are registered only when both sides are active. Their
absence must not change the base mod from available to blocked.

### Suggestions

Suggestions are wizard/UI recommendations. They have no resolver semantics and
are never automatically enabled.

### Conflicts

Conflicts are symmetric after normalization. A selected conflict makes the plan
invalid until the user chooses one side. Source priority is not a conflict rule.

### Cycles

The hard dependency graph must be acyclic. Error output includes the complete
cycle path. Optional edges are excluded from activation order but integration
hooks must be idempotent and must not recursively activate each other.

### Why v1 depends on mod IDs

Capability-symbol dependencies allow interchangeable providers, but introduce a
provider preference solver, ambiguous cycles, and compatibility negotiation. No
current requirement needs that complexity. Kernel capabilities remain symbolic;
mod-to-mod dependencies use IDs in v1. A later manifest version may add
`provides.capabilities` with an explicit provider policy.

## Resolved state

The resolver returns one immutable `ResolvedModGraph` containing:

- installed package records and integrity;
- desired state by scope;
- effective selected state;
- normalized dependencies and reverse dependencies;
- compatibility and trust verdicts;
- requested versus granted permissions;
- activation order;
- blocked mods with typed reason chains;
- warnings and optional integrations;
- lock generation/hash.

No surface builds its own interpretation of config. All consumers use this graph.
One runtime host owns the registry instance. Mods receive a host-created context
and cannot import or instantiate another kernel/registry through the public API.

Resolution is deterministic for the same normalized inputs. Source precedence,
ASCII identifier rules, semver/prerelease/yanked/downgrade behavior, exact platform
cells, one-version-per-ID, optional-edge ordering, stable topological ties, and
frozen/offline behavior are frozen in the contract index. Ambiguous or
unsatisfiable input fails; ambient `node_modules` contents do not participate.

### Status reasons

Blocked/error reasons are typed and machine-readable:

- `not-installed`
- `incompatible-agon`
- `incompatible-mod-api`
- `integrity-mismatch`
- `untrusted-source`
- `permission-not-granted`
- `missing-dependency`
- `dependency-blocked`
- `dependency-cycle`
- `conflict`
- `duplicate-contribution`
- `migration-required`
- `active-resource`
- `load-failed`
- `activation-failed`

Every human message derives from the typed reason and includes the shortest
recovery action.

## Lockfile

`mods.lock.json` is generated, deterministic, and atomically selected with an
immutable generation. Its executable schema is
[`modular-agon-lock.schema.json`](./schemas/modular-agon-lock.schema.json). It records:

```json
{
  "schemaVersion": 1,
  "kernelVersion": "1.0.0",
  "apiVersion": "1.0.0",
  "desiredStateHash": "sha256:...",
  "graphHash": "sha256:...",
  "packages": []
}
```

Secrets and raw permission values are not copied into the lock. A run receipt
records `graphHash`, active mod IDs/versions, and grants hashes so behavior is
reproducible without leaking credentials.

Lock bytes use RFC 8785-compatible canonical JSON and SHA-256. Each package record
carries source identity/locator, content and manifest hashes, exact platform,
dependencies, resolution order, and trust/grant record IDs. `graphHash` covers
resolved content and policy inputs. Timestamps and monotonic generation identity
live in the journal/current pointer/receipts, so equal normalized inputs produce
byte-identical lock bytes; two generations may intentionally select the same lock.

## Activation transaction

All graph/state mutations follow the same writer lock and journal protocol:
install, enable, disable, update, uninstall, profile apply/definition update,
grant/revoke, trust/untrust, setup action, rollback, purge, garbage collection,
and kernel compatibility switching. Read-only plan/inspect operations do not take
the writer lock; they carry an input generation/fingerprint and must be replanned
if it changes before apply. Destructive purge and trust/permission/setup actions
have additional approvals, but not a separate mutation mechanism.

### Phase 1: plan

1. Acquire a mod-state file lock.
2. Read installed index, desired config, prior lock, compatibility, and grants.
3. Resolve the proposed graph without importing code.
4. Compute package downloads, dependency closure, reverse disable closure,
   conflicts, permission deltas, active-resource blockers, and data migrations.
5. Present a deterministic plan and require approval where policy requires it.

### Phase 2: apply

1. Download/install into a staging directory with lifecycle scripts disabled.
   npm receives an explicit temporary HOME/XDG/TMPDIR and empty user/global
   config files. Preserve only a caller-selected cache outside that owned tree.
2. Verify package identity, integrity, manifest, containment, and compatibility.

   Managed npm artifacts bind `payloadHash` into the lifecycle plan. This hash is
   SHA-256 of canonical JSON for the package-owned file inventory, ordered by
   path using JavaScript's default string sort. Each record has `path`, `size`
   in bytes, and `contentHash` (a `sha256:` file digest). Generate the inventory
   from the actual packed archive. Verify installed bytes before importing code.
   This does not change the archive meaning of `contentHash` or SRI `integrity`.
   The root `node_modules` directory is a separate dependency namespace, excluded
   from this payload hash. Its resolution and package identities require separate
   verification; a passing payload hash alone does not qualify activation.

   The launcher is separate from the toggleable package graph. Setup binds its
   version, locator and full payload hash into the lifecycle plan and retained
   installation record. The expected hash comes from the operator-trusted
   bootstrap's packed file inventory, recorded in its bundled release channel.
   The generator checks that inventory against the final packed launcher. Setup
   snapshots those bootstrap files, including both channel copies, with bounded
   reads and no symbolic-link aliases. It does not derive expected identity from
   downloaded candidate files or embed a circular self-hash.
   Candidate verification checks the complete launcher payload before execution,
   after activation and after smoke; shortcut qualification checks it again.
   Missing identity requires qualification, not grandfathered approval. Trust in
   the initial bootstrap is assumed; these checks do not establish publisher
   provenance or independently qualify nested npm dependencies.

3. Run declarative data/config migrations against staged copies.
4. Build a complete immutable candidate generation, including desired config,
   canonical lock, packages, static assets, and migration outputs.
   The candidate subprocess consumes the staged configuration bytes and exact
   planned selection. It verifies all five surface projections with multiplicity
   preserved, then disposes activation handles before emitting its completion
   record. A zero exit without this record does not qualify activation.
   Recheck package containment and payloads after activation and launcher smoke.
   On macOS/Linux, terminate the owned process group on every terminal path.
   This is not a sandbox: a descendant that creates a new session can escape
   process-group cleanup. Dependency-resolution qualification remains separate.
5. Import/register the candidate graph only in a sacrificial subprocess. Apply
   time/output/resource bounds and run registry invariants and mod smoke checks.
6. If validation succeeds, atomically select the candidate as the durable current
   generation. This pointer switch is the commit point.
7. New one-shot processes load the committed generation. Existing invocations
   remain pinned to their prior generation until completion.
8. Long-lived hosts stop accepting stale new work, drain generation-owned jobs at
   the declared safe point, dispose in reverse dependency order, then reload or
   restart. A timeout becomes `restart-required`; mixed-generation dispatch is
   forbidden.
9. On any pre-commit failure, delete/quarantine staging and leave the current
   generation untouched. On a post-commit host-reload failure, retain both
   generations, mark the host degraded/restart-required, and permit safe-mode
   rollback.
10. Record the transaction/recovery journal and release the writer lock.

No transaction mutates a committed generation in place. A crash-recovery journal
distinguishes pre-commit staging, committed pointer, and post-commit cleanup. On
boot, the minimal kernel can enter safe mode, inspect/disable/rollback a broken
mod, and recover without importing third-party executable code.

### Atomicity across cached surfaces

“Atomic” means there is one authoritative graph generation at every execution
boundary; it does not claim that third-party clients instantly forget discovery
metadata they already cached.

- One-shot Citty commands resolve the graph before `defineCommand()`/`runMain()`;
  the process exits after a mod transaction, so the next invocation builds the
  new command tree.
- The long-running TUI pins its loaded generation, stops stale dispatch, and
  drains/reloads or restarts after the transaction commits. It never hot-merges
  the old and new registries.
- MCP emits `tools/list_changed` where protocol/client support exists, but cached
  clients are expected. Every call carries or resolves a generation; disabled or
  unowned IDs return `MOD_UNAVAILABLE`, while a host that has not adopted the
  committed generation returns a typed stale-host/restart-required result before
  handler execution.
- Daemons, job workers, and browser/native hosts include protocol and generation
  identity in their handshake. Running jobs retain a lease on their pinned package
  generation; new jobs are rejected while the host drains.
- Any legacy/lazy handler retained during migration begins with the same kernel
  availability guard. A cached function reference is not authority.

Discovery convergence is eventually consistent; execution authorization and
generation ownership are immediate and authoritative.

## Enable and disable behavior

Examples use friendly names; config and locks store canonical IDs.

### Enable a dependency

```text
agon mod enable think
=> enables think only
=> offers goal/pipeline-delivery as suggestions, but does not select them
```

### Enable a dependent

```text
agon mod enable pipeline-orchestration
=> plan: enable brainstorm, forge, tribunal, pipeline-orchestration
=> one confirmation, one atomic transaction
```

Already-active dependencies are retained. Optional suggestions are shown but not
selected.

### Disable a dependency

```text
agon mod disable think
=> plan: disable think plus every active hard dependent
=> show why each dependent is included
=> one confirmation, one atomic transaction
```

`--no-cascade` refuses if the reverse closure is non-empty. There is no state in
which an active dependent points to a disabled hard dependency.

### Stale caller behavior

An old MCP client or script may call an ID disabled after it cached discovery.
The kernel returns a stable `MOD_UNAVAILABLE` error with mod ID, status, reason
chain, and the enable command. It does not route to an approximate alternative.

## Mod registration API

Executable entrypoints export one default factory:

```ts
const createMod: AgonModFactory = async () => ({
  apiVersion: '1',
  activate(registrar, services) { /* owner-tagged registrations */ }
});
export default createMod;
```

The host calls the factory without ambient authority, then supplies one registrar
and a `ModServices` capability object built from manifest requests and exact grants.
The complete compile-only contract is
[`mod-api.ts`](./fixtures/modular-agon-contracts/mod-api.ts). It defines typed
CLI/TUI commands, intents, MCP/Cesar tools, plan steps, lifecycle handlers, result
readers, docs, config, cancellation through `AbortSignal`, consumer-driven
`AsyncIterable` streaming, stable failures, and host-owned state/dispatch/receipt/
permission/logging services. Every registrar call returns an owner-tagged disposer.
Registration after activation is rejected in v1.

Returned owner-tagged disposers are the only v1 deactivation ABI. There is no
separate deactivation entrypoint. The host calls disposers in reverse dependency
and reverse registration order with a bound timeout. Failure leaves the process
restart-required and never authorizes a mixed generation.

## Surface contribution contracts

### Command

One command definition contains CLI and TUI presentation, schema/parser, aliases,
permissions, job behavior, and handler reference. A projection may omit a surface
only when declared explicitly.

### MCP tool

MCP metadata and handler/direct-call translation are owned together. Disabling a
mod removes the tool from new discovery and returns `MOD_UNAVAILABLE` to stale
callers.

### Cesar action and plan step

Each declares prerequisites, risk/cost metadata, argument schema, handler, and
fallback behavior. Cesar cannot propose a disabled action. Existing persisted
plans containing unavailable step types become paused with an explanation; they
are never silently rewritten.

Persisted steps use the common plan envelope schema, whose owner mod ID/version,
payload version, session/trace IDs, receipt IDs, status, and opaque payload are
mandatory. Contribution IDs live inside the versioned payload rather than package
paths or implementation symbol names.

Package paths and implementation symbol names never become persistent IDs. A mod
must supply pure, versioned migrations for every supported persisted schema. If
the producer is absent, incompatible, or a migration is unavailable, the plan is
paused and remains byte-preserved.

### Result and lifecycle

Result types provide schema version, formatter, persistence policy, and optional
rating discipline. Events are namespaced. Subscriptions are owned/disposed by the
mod instead of being hard-coded in app lifecycle.

Each run stores the versioned result envelope plus a generic JSON representation
and a rendered text/Markdown snapshot. Historical output therefore remains
readable without importing executable code from an absent mod. When an active
compatible mod supplies a newer pure reader, it may enhance the view; the stored
fallback is never discarded.

### Docs/help

Guide content, examples, “when to use,” dependencies, costs, and availability are
generated from active/installed registry data. Documentation can display disabled
mods in an “available to install/enable” section without advertising them as
callable.

## Package inspection bounds

Package inspection streams directory entries and rejects trees with more than
4,096 entries, including directories. The existing limits of 2,048 files,
32 directory levels, 16 MiB per file, and 64 MiB total remain in force.
File reads use nonblocking, no-follow opens and recheck descriptor identity;
a file replaced by a named pipe must fail without waiting for a writer.

## Configuration contract

Each mod owns a namespace keyed by canonical ID. It supplies a schema, defaults,
and pure versioned migrations. Unknown mod config is retained while the mod is
disabled or absent.

Configuration layers produce two different results:

- **desired activation:** explicit user-global enable/disable requests and profile;
- **mod settings:** values within a mod-owned schema.

Repository/private project config can narrow settings for an already-enabled mod
but cannot request or change activation, installation, trust, or permissions.
Unknown settings are retained. Opening a project never downloads or executes mod
code.

## Explicit transaction recovery

`AGON_MOD_SAFE_MODE=1 agon mod recover transactions` replays existing transaction
journals. It does not install packages or approve a new generation. Recovery
holds the lifecycle writer fence, refuses live writers, reclaims a confirmed dead
generation writer, then completes host journal recovery before installation
cleanup. Installation cleanup rechecks selected and retained generations under
the generation writer fence. A competing writer causes refusal, not forced unlock.

Kernel-only safe mode keeps management commands reachable when a writer lock
blocks host boot. It does not reclaim that lock during bootstrap or activate mods.
In this case it reports no selected generation; explicit recovery must establish
the durable state. Existing verified-generation selection remains the two-step
`agon mod recover <generation>` preview and exact `--approve` flow. Transaction
recovery rejects `--approve` rather than interpreting a generation approval.

Recovery markers use unique `.reclaim.<pid>.<uuid>` paths. A partial marker write
still identifies its process. Admission and recovery remove only uniquely named
markers whose PID no longer exists. A live PID, unreadable inventory, or unknown
marker blocks admission; age never proves that a writer is dead. Legacy shared
`.reclaim` files require operator inspection and are not deleted automatically.
Both synchronous and asynchronous writers inspect recovery markers after lock
publication, then recheck ownership before returning. A recovering process
removes only its own marker. A new process can resume after the reclaimer dies
before or after removing the old writer lock. This protocol does not qualify
mixed old/new candidate processes or hostile same-user filesystem mutation.
Overlapping asynchronous releases share one operation. Synchronous release
refuses while asynchronous release is in flight. A cleanup failure preserves
the primary recovery failure as part of an aggregate error.

Recovery receipts are retryable without repeating cleanup. Malformed receipts
fail closed. This command recovers writer ownership, not purge authorization.
New receipts are published atomically, so a partial write cannot publish a broken
receipt. Retry syncs the terminal lifecycle journal and its directory before
completing its receipt. Rollback syncs removal parents before its terminal marker.
Verified generations that never declared `installation.json` remain recoverable;
a missing declared artifact is corruption, not an unmanaged generation.
Complete lease-aware retention remains unfinished. The explicit purge CLI is
described under Approved purge replay below.

The retention report's `accounting` block measures regular-file logical bytes
under the managed host root. It excludes `locks` coordination files explicitly.
Existing storage totals include generation metadata and staging. Installation
totals count shared payloads once. `other` lists all remaining root entries,
including receipts, journals, leases, saved approvals and unknown retained data.
The total adds these disjoint groups; it does not add per-generation sizes again.
Listed data is not approved for deletion. A metadata or directory-enumeration
failure, symlink, special file or unsafe size fails rather than implying zero.
Counting does not read file contents; content-read permission is not required.
Lifecycle-owned groups are protected by the two writer fences. Auxiliary files
such as saved approval plans can be written without those fences. Their sizes
are observations during the scan, not one atomic filesystem snapshot. Concurrent
auxiliary writes can change usage before or after the report. Collection must
revalidate its exact targets and report any remaining quota shortfall.
These are measured file sizes, not allocated disk blocks or guaranteed reclaimed
space. Retirement preserves evidence that can outweigh the removed metadata.
External caches are outside this accounting block. Quota collection below adds
the engine-catalog binary cache once when it is outside the host root.

`agon mod retention` reports retained installation IDs, every generation that
references each installation, and unreleased process leases. It acquires the
lifecycle then generation writer fences to keep lifecycle references consistent. It does
not delete data, expire leases, or authorize collection. A lease for a missing
generation blocks reference inspection and purge. Corrupt leases and generation
references fail closed. Released leases are omitted. Inspection does not
reject a valid rollback merely because its selection transaction differs from the
generation's creation transaction. A different transaction must have a verified
or committed rollback journal bound to the same generation and lock hash. Graph
and lock hashes must still match the immutable manifest. Missing, malformed,
linked or unrelated selection journals fail closed. Inspection never performs
snapshot recovery or changes the selected pointer. This report does not yet
include rollback-window leases, cache sizes, or quota policy. Explicit window
inspection is described below. All retained generation references still protect installations.
`hasCommittedGeneration` means at least one listed generation has a committed
transaction; it does not label every listed generation committed. The kernel
inspection object retains failed lock releases and retries only its own fences
on the next call. It refuses a replacement owner's lock. Scan and cleanup errors
are preserved together; an incomplete cleanup is not reported as success.

The `generations` inventory lists each validated generation in numeric order,
including generations with no installation record. Each entry reports its nullable
installation ID, creation transaction's committed state, current selection,
metadata logical bytes and active process/artifact lease IDs. Released references
are omitted. The inventory and installation references use one validated scan
under the existing writer fences. Generation bytes are a breakdown of the
`generations` storage entry, not additional bytes to add to storage totals.
Shared installation payload bytes remain counted once in `installations`.
Selection and lease fields describe current references, not collection permission;
persisted rollback-window policy and automatic collection remain unfinished.

`agon mod retention inspect --rollback-window-ms <duration>` adds a read-only
`rollbackWindow` report for an explicit non-negative integer duration. No duration
is assumed. Each generation reports selected, window, elapsed or unknown-history
protection. Expiry is not deletion permission: process leases, artifact references
and other lifecycle constraints still apply. Inspection does not release leases,
save policy or remove files. Bare `agon mod retention` keeps its existing output.

New committed generation and rollback receipts carry `previousSelection`, the
exact prior pointer. This additive receipt field leaves the journal schema and
old readers unchanged. Window inspection walks links backward from the current
pointer and uses the latest proven departure from each generation. It validates
receipt/journal identity, base generation and lock, pointer identity and generation
manifest. Missing, legacy or reconstructed receipts without predecessor links
stop the chain. Older departures remain unknown, not expired. Incomplete
transactions and uncertain clock ordering also preserve protection. Recovered
receipt timestamps are not presented as exact historical selection times.

Each listed installation includes `logicalBytes`. `totalInstallationLogicalBytes`
sums each installation once, even when multiple generations reference it. These
values count regular-file bytes per path, including installation metadata, without
reading file contents. They are not allocated or reclaimable disk space; hard-linked
paths count separately. Missing, unreadable, linked or special entries and unsafe
integer totals fail the report. The existing writer fences cover the inspection.
`unreferencedInstallations` separately lists prefixes with no generation reference,
with `totalUnreferencedInstallationLogicalBytes` as their sum. The original
`installations` and `totalInstallationLogicalBytes` fields remain retained-only.
The inspector rejects malformed prefix names, links, non-directory prefixes and
incomplete inventory reads. Both groups use the same size walker and writer fences.
An unreferenced prefix is not necessarily qualified or safe to delete; pending
lifecycle records or other retention policy can still matter. Reporting reads no
payload contents and removes nothing. Separate `storage` entries count regular-file
bytes in `generations`, `staging`, `installation-staging`, and `purge-staging`, in
that order. `totalStorageLogicalBytes` sums only these entries, not installations.
Missing roots count zero; failed reads, links, non-regular entries and unsafe size
totals fail closed. These sizes are neither allocated disk space nor permission
to collect files. The default npm cache lives in temporary candidate staging;
caller-selected external caches are not scanned. Explicit quota collection is
available through the CLI as described below; it is not release-qualified.
The size report assumes all concurrent writers obey the managed fences. Path
checks reject observed links and read failures; they are not atomic traversal
against an external actor swapping filesystem entries between checks. A byte
report is not a destructive authorization or a filesystem sandbox.

The engine-catalog owner exposes `inspectBinaryCache`, `evictBinaryCache` and
`recoverBinaryCacheWriter` for the exact `cache/binaries.json` path in an explicit
Agon home. Inspection binds file identity and logical bytes. Eviction removes
only that identity; missing or replaced files are reported without chasing new
bytes. Symlinks and special files are rejected. Hard links retain the same
per-path logical accounting as the host report; removal does not claim physical
space reclamation. Cache replacement and eviction share the kernel writer fence.
Explicit recovery reclaims only a dead writer through the same liveness protocol.
Older unfenced publishers must be quiescent before collection. These owner APIs
do not persist approval: the quota coordinator must durably consume an attempt
before eviction and retain an unknown outcome after interruption or sync failure.
The kernel quota coordinator composes these APIs with generation retirement and
installation purge. Its saved parent plan binds fixed child plans and policy.
Cancellation intent is persisted before child cleanup and survives ordinary
resume. Conditional installation identity is part of the child purge plan hash,
so the ordinary purge API cannot bypass that identity check. Consumed absence
does not authorize deleting a later replacement. Parent terminal states do not
restart when storage grows later. Preview adds only complete candidate groups
whose exact saved approval fits 256 KiB. A large inventory does not prevent a
smaller useful approval. Application validates cache byte counts even when host
accounting already includes that cache.

Conditional purge plans bind original root permissions as well as content.
Cancellation validates identity before restoring a root made writable for rename.
Quota inspection can recover proven dead writers; live writers still block it.
Inspection cleanup retains ownership across inspector instances for the same host.
Real process-kill tests cover inspection release, payload permission transition
and payload rename. These checks do not constitute complete release qualification.
The complete failure matrix and release qualification remain incomplete.

`agon mod retention quota --quota-bytes <bytes> --rollback-window-ms <duration>`
previews quota collection. Both values must be explicit non-negative safe integers.
The CLI binds the existing cache owner to the canonical Agon home, independently
of `AGON_MODULAR_HOST_ROOT`. Preview does not create a missing home or cache.
It saves the kernel plan in the existing pending-authority directory and prints
the exact approval command. A null plan reports either `already-below-quota` or
`no-net-beneficial-collection`; the latter is not success at meeting the quota.

`agon mod retention quota <saved-plan> --approve <hash>` applies that exact plan.
Replacement quota or window flags are rejected. Add `--cancel` with the same
plan and hash to cancel pending work and finish already-started cleanup.
Output separates durable attempt state from current `logicalBytes`, `quotaMet`
and `shortfallBytes`. Preserved receipts, approvals and protected data can leave
a shortfall even after successful removals. These are logical file sizes, not
physical disk savings. Terminal replay never starts collecting later growth.
No quota default, automatic collector or persistent policy is introduced.

`artifactLeases` lists explicit reproducible-artifact references. Version-2 lease
records bind one generation to an owner, opaque artifact ID and SHA-256 content
hash. The hash is supplied by the caller, not independently verified by the host.
These records share the process-lease directory and writer fence but contain no
PID or heartbeat. They do not expire on age or process death. Process lease APIs
reject artifact records; existing version-1 process records remain supported.
Older readers reject version-2 records rather than silently ignoring protection.

`leaseArtifactGeneration` validates the generation before durable publication.
An optional UUID request ID makes acquisition idempotent under the writer fence.
Reusing that ID with a different reference fails. Reusing it after release returns
the released record; it cannot restore protection. Calls without an ID create
independent references, preserving the original API behavior.
`releaseArtifactGenerationLease` requires the same owner, artifact ID and hash,
including on an idempotent retry. Creation and release retain their timestamps in
the atomic record. Failed acquisition cleanup never automatically releases an
artifact reference. Release retries sync an already-released record and directory.
Failed artifact writes remain pending in the owning store. Cleanup rechecks record
identity under the writer fence and syncs the file and directory; it never converts
an artifact reference into a process cleanup release. A changed identity blocks
cleanup. If publication never created a record, cleanup removes only its pending
in-memory entry. Cleanup failure is reported, not treated as durable success.
Malformed records and missing referenced generations fail inspection and purge.
Caller owns approval and artifact verification; identity matching is not a sandbox.
Automatic workflow-artifact attachment and persisted rollback-window policy remain
unimplemented. Explicit generation collection is described below. No active/global
installation is migrated by these APIs.

Operators use `agon mod retention retain <generation> --owner <id> --artifact <id>
--hash sha256:<digest>` to preview an artifact reference. `agon mod retention
release <lease-id>` previews release. Each command prints a saved plan path and
an exact `--approve <plan-hash>` command. Preview changes no lease. Approval binds
the operation, request ID and identity; retain also binds the generation content
hash. Release rejects a changed record. Retrying an approved request does not
create another reference. These commands never open the artifact ID as a path or
delete artifact, generation or installation files. `agon mod retention` without
a subcommand remains the read-only report.

### Explicit generation retirement

`agon mod retention collect --generation <id> --rollback-window-ms <duration>`
previews removal of explicit expired generations. Repeat `--generation` for a
batch. There is no default duration or automatic target selection. Preview saves
an exact plan and prints its approval command. A plan larger than the existing
256 KiB saved-plan limit fails with instructions to use a smaller batch.

`agon mod retention collect <saved-plan> --approve <hash>` retires only that
plan's generations. It binds the host root, selected pointer, explicit window,
generation manifests and terminal receipt evidence. Under lifecycle then generation
writer fences, apply checks current references, selection and history again.
Selected generations, active process/artifact leases, unknown timing, unfinished
selection work and unfinished installations prevent new retirement. Another
persisted collection plan cannot reserve the same generation.

Retirement uses the existing purge namespaces with a distinct typed journal.
Ordinary purge cannot target generation paths. The new plan uses schema version3;
its journal uses version2 and the generation-retention kind. Each target moves
through pending, staged and removed. Durable intent precedes the quarantine
rename; both parents are synced before staged publication. Staged is logical
retirement. Physical deletion is explicit, retryable cleanup. A missing original
and quarantine before staged is corruption, not successful removal.

Add `--cancel` with the same saved plan and hash to cancel untouched pending
targets. Already-staged cleanup finishes, but pending originals are not deleted.
Cancelled targets release their reservation and need a fresh preview for removal.
Retry never deletes replacement bytes at an original path. Output lists only
generations actually removed, including prior completed targets in the same plan.

Original selection receipts and journals remain. The retirement journal preserves
validated terminal evidence so host recovery can repair a lost receipt after
generation bytes are gone. This includes rollback selections of the same generation.
Window inspection can use preserved exact predecessor links. Historical evidence
never makes a generation executable: validation, leases and rollback reject retired
IDs, including valid old bytes copied back into their original directory. Invalid
retirement history blocks execution; it does not authorize deletion or repair from
unverified metadata.

Boot does not start collection or remove quarantine. A rename interrupted before
its staged marker requires explicit plan replay. If interrupted before rename,
host recovery verifies original bytes and restores immutable root permissions.
This does not change existing recovery of an uncommitted installation transaction.

This explicit generation operation removes metadata only. Quota collection above
composes it with cache collection and conditional installation purge. Complete
retention acceptance remains open. This does not certify the modular release.

### Foundation mutation evidence

`npm run test:modular-foundation-mutation` retains the existing verifier negative
controls and separately tests six implementation faults in a disposable archive
of committed HEAD. Runtime source and test inputs must match that commit. It
uses installed dependencies but does not install or alter them. The selected
faults affect manifest fields, dependency uniqueness, resolver precedence,
registry owner identity, canonical JSON ordering and the public API boundary.
A green baseline is mandatory. Each fault must fail its named existing assertion.
Timeouts, syntax/import errors, teardown errors and missing reports are not kills.
Real unchanged-code, syntax-error and teardown-error controls check the evaluator.
The emitted receipt includes source hashes and raw test reports before scratch
cleanup. This measures those six faults only, not all possible mutations or
independently packed release behavior.

### Approved purge replay

The kernel purge API issues version-2 plans. Each preview includes a fresh
`transactionId`, selected generation, exact installation/data paths and a hash
over those fields. Version-1 approval plans require a new preview. Reusing an
approval does not authorize removing replacement data at a previously purged path.
Targets must be distinct and non-overlapping after path normalization.

Under lifecycle then host writer fences, apply atomically publishes
`purge-transactions/<transactionId>.json`. Its strict version-1 record
contains `schemaVersion`, the approved `planHash`, and one phase per target:
`pending`, `staged`, `removed` or `absent`. Targets move first to
`purge-staging/<transactionId>/<target-index>`. Both rename parents are synced
before the staged phase is persisted. Only that quarantined target is removed.

Before selecting any pending original path, apply checks the approved generation
and retained installation references. Reference inspection validates generation
files, the matching transaction identity and the installation bytes it reads.
Missing declared records, linked generations and mismatched journals refuse
deletion. Completed or already-quarantined targets do not select original paths
again. An entirely quarantined transaction can finish after a generation change;
a mixed transaction with pending original paths still requires its original
generation and reference checks before any further removal.

Retry with the original plan resumes staged removal and returns prior completed
results without selecting the original paths again. A new preview is required
to purge newly created data. Malformed journals refuse further effects. Journals
and quarantine storage are protected from ordinary data-path purge. Removal is
irreversible; quarantine is a recovery mechanism, not a backup.

`agon mod purge --installation <id> --data <absolute-path>` saves an exact preview
under `pending-authority` and prints its paths, hash and irreversible-removal
warning. Either flag can repeat; neither selects targets automatically. With no
targets the command refuses. Relative data paths are rejected. Installation IDs,
protected state, references and links are checked by the kernel API. The approval
plan store itself is protected from purge. Protected namespace comparisons use
Unicode compatibility normalization and lowercase on every supported platform,
so a case alias cannot bypass the protection on a case-insensitive filesystem.

Generation commit, generation recovery and managed installation also report
writer-release failures. If transaction processing also fails, the aggregate
retains the original operation error and the release error. A committed pointer
or qualified prefix remains selected; cleanup failure does not imply rollback.
Simulated host crashes still retain their fence for crash-recovery tests.
Managed installation preserves nested host failures through the standard Error
cause field while keeping its existing lifecycle error code. Causes remain
non-enumerable; persisted receipt fields retain their existing representation.
When host commit or installation also fails to release its writer, the aggregate
retains the translated operation error, including its recovery code and transaction
context. Its cause retains the original failure. An unknown pointer outcome stays
explicitly unknown even when both host and installation cleanup fail.
Trust/grant transactions protect sequence reads and plan validation with the
same writer cleanup boundary as record publication. Rejected approval or invalid
plan data leaves no new authority record and releases the writer. Apply and
recovery report release failures and retain any operation error alongside them.
Generation rollback uses the same boundary for target validation, journal setup
and pointer publication. Setup failure releases its writer. Failed release never
reports success or reverses an already selected pointer. Snapshot failures retain
their restart-required code and original cause when release succeeds; combined
operation/release failures preserve both errors for inspection.
External activation apply, recovery and outcome recording use this same release
contract. Completed records remain intact. Bootstrap callers retain their existing
diagnostics and fail-closed authority behavior; cleanup failure creates no grant.

Purge and lifecycle recovery attempt both writer releases in reverse acquisition
order. A release or directory-sync failure rejects the operation instead of
reporting success. If the operation also failed, the aggregate error preserves
both causes. This does not undo completed effects or reclaim a live owner's lock.
After the owning process exits, explicit transaction recovery can reclaim stale
locks; purge retries must retain the original saved plan to preserve replay safety.

`agon mod purge <saved-plan> --approve <hash>` applies only that saved preview.
Replacement selection flags and other plan kinds are rejected. Saved plans also
require at least one target and absolute string paths before apply. Apply uses the
same kernel generation checks, writer fences and replay journal; it does not
duplicate removal logic in the CLI. Retrying reports the original completed
paths and never selects replacement data at those paths. This command is
available in kernel-only safe mode. It does not implement automatic collection,
quota policy, generation expiry, a complete retention report, or release acceptance.

## Forge synthesis decision ownership

`@kernlang/agon-mod-forge` owns `planSynthesis` and its three public input/result
types. The legacy Forge runner imports this public owner directly. The old
`packages/forge/src/synth-plan.ts` path only re-exports the same function and types
to preserve imports; it contains no second implementation or local workflow logic.
Importing it still evaluates the physical package's normal module graph.
The existing selection, tie order, test-bearing base choice and reasons stay
unchanged. The compatibility path can retire with the legacy Forge public package
after its remaining consumers migrate; it must not grow new policy. The identity
regression rejects a second implementation behind that path.
This move does not complete competition, synthesis execution, gauntlet or corpus
ownership. Those remain separate migration requirements.

## Forge public type ownership

`mod-forge/src/types.ts` owns the Forge options, scored results, manifests,
events, judgments, gauntlet artifacts and corpus types. Core re-exports these
types for existing consumers. These are type-only exports; disabling Forge does
not remove historical type declarations or activate its workflow.
The Core dependency on mod-forge is explicit and acyclic. The compatibility
exports retire only when Core's public compatibility surface retires.
The compile-only boundary test checks declaration identity through both public
packages and rejects invalid events, modes and incomplete persisted records.

The frozen inventory classifies `EngineResult` as engine-runtime by name. Its
fields describe a scored Forge candidate, not an engine dispatch response.
This migration puts that declaration beside `ForgeManifest`, its owner, without
changing fields. The frozen baseline remains intact; final ownership reconciliation
must record this correction. Runtime Forge extraction remains incomplete.

## Forge corpus ownership

`@kernlang/agon-mod-forge` owns the corpus persistence and selection functions in
`createForgeCorpus(path)`. The storage path is explicit. Creating an instance does
not read or write state. Instances supplied distinct storage paths operate on
distinct files. Instances supplied the same path share that file and its temporary
write path.
The legacy Forge corpus module supplies the existing `CORPUS_PATH` and exposes
the same synchronous functions. It has no storage or selection implementation.
That adapter retires with the remaining legacy Forge consumers, not before.

The existing JSON format, validated-artifact filter, 200-entry retention, pattern
history, replay counts and historical readers remain unchanged. This preserves
existing behavior, including its file-level read/modify/write concurrency limits;
it does not add transactional corpus writes or claim new corruption protection.
Connecting gauntlet execution to physical Forge remains a separate requirement.

## Fitness process ownership

Fitness commands use support-engine-runtime's shared process runner. A pre-aborted
signal does not start a command. Cancellation and timeout terminate the owned
process group, including descendants with open pipes, and escalate to SIGKILL.
Support-verification owns fitness validation and its public result envelope.
The approved verification-to-engine-runtime dependency makes the target DAG
49 packages and 153 unique edges. The frozen legacy assignment count is unchanged.

Fitness retains at most 1 MiB of decoded UTF-8 bytes per output stream. Capture truncation
does not fail or terminate a successful command. UTF-8 decoding spans chunks;
an incomplete character cut by truncation is omitted. The shared runner's existing
combined output overflow guard still terminates when selected. Bounded capture is
opt-in; existing callers retain their default result fields and overflow behavior.
Spawn failures still reject the fitness promise. Process tests use real local
children, not providers. This does not establish complete Forge runtime parity.

## Forge gauntlet ownership

`mod-forge/src/gauntlet.ts` owns breaker prompts, artifact validation, breaker
dispatch, repair decisions, events and the gauntlet result. Its runtime argument
supplies existing Git worktree operations, fitness scoring and sidechain logging.
Runtime functions must be free functions or bound functions; the workflow calls
them without a receiver. The legacy facade supplies free functions.
The owner imports engine contracts and subprocess execution from the public
engine-runtime package. It imports no Core or legacy Forge implementation.

The legacy gauntlet module binds those effects and preserves its exports. That
adapter retires when the legacy Forge caller retires. The standalone generated
Forge competition still needs gauntlet integration; moving the workflow is not
proof that its hardened option works through every surface.

Artifact validation requires two completed failures on patched code and a
completed success on clean code. Timeouts, cancellation, reported spawn errors
and thrown process errors are not attack evidence. UUID filenames keep engine
IDs out of shell syntax. Validation forwards cancellation and bounds captured
output to 1 MiB per stream through the existing process runner. Arbitrary shell
command failures remain indistinguishable from test failures. Full-workflow
cancellation and physical fitness integration remain separate work.

## Forge fitness scoring ownership

`mod-forge/src/scoring.ts` owns `FitnessResult`, its score contracts, default
weights, composite scoring and tie-breaking. Core retains compatibility exports
for existing callers. The formulas and ordering remain unchanged. These exports
retire with their legacy callers; no second scoring implementation is introduced.
The physical competition's simpler candidate scoring is not yet equivalent to this
full fitness path and must not silently replace it.

## Forge fitness and quality ownership

`mod-forge/src/fitness.ts` owns shell normalization, fitness execution, post-test
patch capture, diff gating, quality checks, syntax penalties, scoring and the
fitness log/result envelope. `mod-forge/src/quality.ts` owns lint/style checks,
changed-file selection and syntax result aggregation. Neither imports Core.

The host supplies existing Git diff operations and the syntax validator through
typed capability arguments. The legacy facades bind these at each call and keep
their existing public signatures. These adapters retire with their legacy
callers. No new package dependency or second validator implementation is needed.
Missing-sidecar and unavailable-tool fallbacks retain their legacy behavior;
they are not evidence that validation actually ran. Full-workflow cancellation,
physical competition integration and legacy caller retirement remain open.

The fitness owner accepts the workflow's optional abort signal. It refuses an
already cancelled invocation, forwards cancellation to fitness, lint and style
subprocesses, and preserves the abort reason before later validation or result
publication. Optional-tool fallback does not swallow cancellation. Legacy
baseline, candidate, synthesis, team and gauntlet callers forward their existing
signals. Baseline worktree disposal still runs on cancellation. This does not
prove that every orchestration phase stops dispatching or that synchronous
syntax validation can be interrupted; those broader cancellation checks remain
separate requirements.

Physical Forge checks caller cancellation between discovery, preflight, baseline,
candidate collection, review and result publication. Caller cancellation is checked
after candidate collection; arena cleanup remains in `finally`. Internal early-finalization signals cancel
losers without cancelling the caller or discarding the passing winner. Gauntlet
checks cancellation before starting and between breaker collection, validation,
pre-repair fitness, repair and post-repair fitness. Its clean comparison worktree
is still disposed when validation stops. No completed result is published after
these guards observe caller cancellation. These checks do not replace the remaining
legacy orchestration and synchronous-validator cancellation qualification.
Cancellation inside the terminal `gauntlet:done` notification does not retract
the completed result. Cancellation inside `gauntlet:repair-done` still stops
workflow completion; that event ends only the repair phase.

Physical Forge submits an unsuccessful terminal run status when a started run
stops before publishing its outcome, including cancellation and invalid Git
repositories. This happens before control returns to a long-lived host, after
arena cleanup. Partial artifacts remain available. A previously submitted
outcome is not replaced by later cancellation; the existing run host retains
responsibility for failed status-write retries.
If one candidate throws outside dispatch handling, Forge drains all candidate
attempts before cleanup and then propagates the original error. It does not
remove a worktree while a sibling attempt still uses it. Existing dispatch and
fitness timeouts, caller cancellation and quorum signals remain unchanged.

## Forge stage ownership

`@kernlang/agon-mod-forge` owns attempt execution, baseline evaluation and both
competition stages through `createForgeStages`. Construction performs no host
effects. Its host interface supplies Git worktree operations, token/cost estimates
and the existing fitness validation effects. Stage selection, dispatch harvesting,
quorum handling, timeout policy and result collection remain in the mod.

`packages/forge/src/stages-impl.ts` is a temporary effect binding for legacy
callers, not another stage implementation. The Forge mod owns `StageResult` and
`WorktreeEntry`; legacy type exports retain their shapes. Remove this binding
when the legacy Forge entrypoint and all direct stage consumers use the canonical
mod runtime. Its parity gates include the real-worktree Forge E2E suite, baseline
cancellation, timeout/harvesting tests and owner-export identity. This extraction
does not yet retire legacy top-level orchestration or complete physical Forge
synthesis, hardened-mode or result-bundle parity.

## Forge prompt and context ownership

`mod-forge/src/prompts.ts` owns Forge candidate, critique and refinement prompts.
`mod-forge/src/stage-context.ts` owns the context types, builder and renderer used
between Forge stages. `Critique` belongs to the Forge public types. These pure
functions perform no host effects. Their strings and type shapes remain unchanged.

Core retains compatibility re-exports, not duplicate implementations. Generic
message parts and other workflows' prompt builders remain outside this move.
The compatibility exports retire when legacy consumers migrate to the public
Forge API; historical data readers must remain available. Owner-identity tests,
existing context tests and real-worktree Forge E2E cover this transition. This
move does not establish complete physical Forge runtime parity.

## Forge refinement ownership

`mod-forge/src/synthesis.ts` owns winner refinement through
`createForgeSynthesis`. The factory binds Git create/remove/apply effects and the
existing fitness effects. It does not start work at construction. Critique
parsing, refinement dispatch, scoring and cleanup remain in the Forge owner.
`SynthesisResult` and `FitnessError` have that same owner. Core re-exports the
error class without creating a second class identity.

The legacy Forge synthesis module is a temporary effect binding. It retires when
the top-level Forge workflow and its public callers use the mod runtime. The
standalone Synthesis mode is distinct and is not changed here. Real-worktree
tests cover agent/exec refinement, passing/failing fitness, patch persistence,
event order and cleanup; the existing fallback test remains. The original
algorithm is preserved. Full generated Forge parity remains unfinished.

## Forge manifest ownership

`mod-forge/src/manifest.ts` owns manifest read, write and update behavior.
`createForgeManifestStore` receives an explicit history directory and the existing
file-lock effect. Construction does not touch stored runs. The legacy manifest
module binds the existing history directory and lock implementation; it retires
with the remaining top-level Forge runtime callers.

Local manifest replacement keeps its temporary-file/rename sequence. History
replacement remains inside the same per-manifest lock used by ratings cleanup.
The deferred-write test proves history cannot change before that callback runs;
a lock-bypass mutation fails it. Read/update roundtrip and real-worktree Forge
tests preserve historical-reader and incremental-publication behavior. Reading
an existing manifest does not require activating the Forge mod.

## Shared result-envelope writer

`support-persistence/src/result-envelope.ts` owns the versioned result writer
used by Forge, Team Forge and Goal. The legacy Forge path re-exports that same
function until its callers migrate. It is shared persistence machinery, not a
Forge-specific workflow or an activation requirement.

The move preserves JSON normalization, owner/contribution fields, status,
version, sibling filename and temporary-file/rename behavior. Existing raw
`result.json` files remain unchanged. Tests cover all three consumer owner IDs
and public function identity. This move does not alter the compatibility
runtime identity supplied by `createPersistenceEnvelope`; final generated-runtime
qualification must still establish the required generation-bound receipts.

## Shared deterministic winner selection

`support-judge/src/deterministic-ranking.ts` owns `determineWinner`, shared by
Forge and AgentTeam. Its input contains only the scalar fields it compares;
the support package imports no Core or Forge result type. Core exposes the
same function through a typed alias that preserves its public `EngineResult`
parameter. A TypeScript checker test rejects loss of that legacy declaration.
The legacy Forge wrapper retains its default spread of eight.

The move preserves passing/positive-score filtering, score order, all five
secondary tie-break fields, stable ties and strict close-call comparison.
Tests cover each comparison field, input preservation, zero-score exclusion,
the exact spread boundary and public owner identity. AgentTeam result conversion
remains a separate concern and is not duplicated in this shared comparator.

## Forge workflow cutover

`mod-forge/src/workflow.ts` owns the complete Forge stage sequence. The generated
competition entry translates its input and output; it does not implement a second
competition. The legacy Forge entry binds the same factory to existing shared
effects. That compatibility binding remains until its callers are retired.

The CLI and MCP hosts provide typed Forge effects to Forge, Team Forge and the
orchestration pipeline. They do not provide a workflow callback. Transport opens
per invocation and checks the captured surface authority before provider entry.
This does not change the generation-pinning policy for existing invocations.

Candidate and synthesis workers retain their worktrees until they settle. A
synthesis timeout aborts refinement, drains its worker and retains the original
winner. Caller cancellation is different: it preserves the caller's reason,
stops later phases and records a failed raw manifest. Caller abort listeners are
removed on success, preflight failure and setup exceptions. Health probes receive
the same cancellation signal. A starter cannot bypass the eligible-engine list.

Raw legacy manifests and versioned result envelopes remain separate from the
generated `competition.json` report. A workflow error fails that report even if a
provisional winner exists. An isolated failed candidate does not fail a winning
sibling. Failed dispatch may still yield an accepted patch under the established
harvest policy. Candidate duration measures the full attempt; fitness-command
duration is recorded separately. Source fitness observers remain composed.

These implementation checks do not establish final release acceptance. The latest
clean committed qualification must include the full ownership and migration ledger,
historical readers, disabled surfaces and installed-candidate checks.

## Registry invariants

The kernel refuses activation unless all hold:

- every public ID has one owner;
- every owner is active and available;
- every alias resolves to one canonical ID without a chain/cycle;
- every hard dependency precedes its dependent;
- all declared permissions are granted;
- all lifecycle handles are owner-tagged and disposable;
- all config writes stay inside the owner namespace;
- no disabled mod contributes a trigger or prompt fragment;
- docs/help and machine discovery reflect the same graph generation;
- run receipts record the same graph generation used for dispatch.
