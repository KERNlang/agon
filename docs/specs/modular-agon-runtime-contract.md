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
2. Verify package identity, integrity, manifest, containment, and compatibility.
3. Run declarative data/config migrations against staged copies.
4. Build a complete immutable candidate generation, including desired config,
   canonical lock, packages, static assets, and migration outputs.
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
