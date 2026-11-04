# Modular Agon blast radius and readiness audit

**Status:** IMPLEMENTATION-READY SPEC; PRODUCTION RELEASE GATES REMAIN
**Date:** 2026-08-20
**Method:** source scan + Agon Think + five-engine Brainstorm + red-team Tribunal

---

## Verdict

The registry-first direction is implementation-ready at specification level. The
inventory, ownership map, schemas, resolver, package DAG, UI hierarchy, kill-list,
performance budgets, and coverage ledger are frozen. This does not authorize a
production install/update cutover: the implementation and release gates below
must still pass in isolated candidates.

Historical Agon run IDs are bound by SHA-256 and adjudicated against current
local source in
[`modular-agon-adversarial-adjudication.md`](./evidence/modular-agon-adversarial-adjudication.md):

- `think-1787263310179-5msjl1-modular-spec-blast-radius` — 20-step, five-branch
  architecture/decomposition pass with independent Codex critique;
- `brainstorm-1787263434544-7vowha` — Codex, Kimi, GLM, MiniMax M3, and Claude
  lifecycle/artifact breadth pass;
- `tribunal-1787263540422-77lasn` — four-seat red-team and synthesized risk
  register;
- `ask-1787264156663-7q8hlg` — fresh independent cross-document review after the
  first amendments.

This is not a rejection of modularity. It identifies where an apparently modular
implementation would still split into multiple authorities, execute unreviewed
code, corrupt state during updates, or strand persisted workflows.

## Completeness method

The audit uses two crossed axes rather than stopping at a feature count.

Lifecycle:

```text
authored → built → packed → published → installed → resolved → loaded
        → active → persisted → updated → disabled/removed → rolled back/purged
```

Artifact/surface classes:

```text
manifest · executable · static asset · schema · config · lock · grant
receipt · session · plan · job · result · rating/history · cache
CLI · TUI · MCP · Cesar · daemon/job worker · browser/native host · docs
```

Every lifecycle transition must define authority, inputs, validation, commit
point, failure result, recovery, concurrency, retained evidence, and platform
behavior for each affected class.

## Blocking architecture clauses

### One immutable graph generation

The durable authority is an immutable generation directory plus one atomically
selected current-generation record. A graph hash identifies content; a monotonic
generation identifies an activation transaction. They are not interchangeable.

Every process pins a generation for an invocation/job. A graph mutation creates
and validates generation N+1 without modifying N. New one-shot processes adopt
N+1 after commit. Existing work finishes on N unless its owning mod explicitly
supports a controlled drain. No handler may combine registry/state from two
generations.

Long-lived hosts compare their loaded generation with the durable current
generation before dispatch:

- CLI one-shot: rebuild projections at boot;
- TUI: drain and restart/reload at a declared safe point;
- MCP: notify discovery change where supported, reject stale dispatch, and
  restart/reload before executing new-generation code;
- daemon/job worker: pin running jobs, refuse new stale work, drain, then restart;
- browser/native host: handshake includes protocol and graph generation;
- docs: full installed catalog and active runtime view are distinguished.

Hot-swapping arbitrary ESM is not an atomicity mechanism because imported modules
cannot be reliably unloaded. Candidate activation smoke runs in a sacrificial
subprocess. Commit flips the current-generation record only after verification.

### Single writer and crash recovery

All install/enable/disable/update/uninstall/profile/grant mutations use one
cross-process writer protocol. The lock includes owner identity, PID where useful,
heartbeat/lease, creation time, and stale recovery. Recovery revalidates ownership
under a fence before reclaim; deleting a lock based only on age is forbidden.

Readers never observe partial generation contents. Staging is on the same
filesystem as the final store where atomic rename/pointer-switch semantics are
required. Supported macOS/Linux lock and rename semantics fail closed; future
Windows sharing/retry behavior is deferred. A journal identifies pre-commit,
committed, and cleanup states after a crash.

### Deterministic resolver

The resolver specification freezes:

- one version per canonical mod ID in one graph;
- lowercase ASCII canonical IDs with rejection of Unicode/case normalization;
- exact precedence for explicit-development, user-folder, configured-registry,
  and bundled sources; committed generations use their exact lock;
- semver, prerelease, yanked, downgrade, pin, override, optional, conflict, and
  platform-condition rules;
- cycle and unsatisfiable-range diagnostics;
- one selected version/owner per ID and generation-owned resources;
- frozen-lock behavior and offline complete-missing-set reporting;
- deterministic topological ordering and collision ordering;
- a normalized input fingerprint so unchanged inputs reproduce lock bytes.

The executable reference and complete rules are indexed in the frozen contract
document. The lock uses RFC 8785-compatible canonical serialization and records registry/source identity,
package version, tarball integrity, manifest hash, extracted-tree/static-asset
hash, platform selection, Mod API range, trust, grants hash, dependencies, graph
hash, and generation. Timestamps/receipts do not participate in the graph hash.

### Boot containment and safe mode

A corrupt, hanging, or throwing mod must not brick the only recovery interface.
The kernel boots a minimal safe mode from the last known-good generation, reports
the failed mod and reason chain, and permits inspect/disable/rollback without
importing third-party code. Registration has a timeout and output/resource bounds.
Dependents become blocked; unrelated mods may boot only when registry invariants
still hold.

Safe-mode selection is deterministic: validate the current pointer and journal;
if current is incomplete or corrupt, try the most recent verified previous
generation compatible with the running kernel; if none validates, boot kernel-only
recovery. Safe mode never chooses a generation merely by timestamp. It can rebuild
the installed index from immutable manifests, report missing rollback bytes,
export state, disable/quarantine selections, and select a verified generation.
It cannot run migrations or arbitrary mod readers until compatibility is proven.

## Persistence and removal clauses

Every persisted executable or display artifact has a versioned envelope containing
at least:

```json
{
  "schemaVersion": 1,
  "kernelVersion": "0.3.0",
  "modApiVersion": "1.0.0",
  "graphHash": "sha256-...",
  "generation": 42,
  "producer": {
    "modId": "@kernlang/agon-mod-forge",
    "modVersion": "1.2.0",
    "contributionId": "forge.step",
    "contentHash": "sha256-..."
  },
  "payload": {}
}
```

Missing-mod policy is per artifact, not one global fallback:

| Artifact | Producer absent/incompatible |
|---|---|
| Historical result/receipt | Render stored generic payload and snapshot; label enhanced replay unavailable; never download/execute code merely to view history |
| Pending plan | Pause byte-preserved plan; fail execution with actionable dependency/install information; never substitute another handler |
| Running job | Continue only on its pinned leased generation; otherwise transition to typed interrupted/recovery state |
| Session/transcript | Load readable generic records and tombstones; unavailable actions remain explicit |
| Config | Retain unknown namespaced values without applying them; migration waits for a compatible producer |
| Ratings/history | Preserve producer/mode identity; aggregate only under declared compatible rating discipline |

Disable and uninstall create tombstones/references; they do not erase state. A
package generation cannot be garbage-collected while a running job, rollback
window, or explicitly reproducible artifact lease requires it. Purge reports all
references, shared dependencies, caches, and irreproducible outcomes before a
separate destructive approval.

Mod ID reuse by a different publisher/provenance is forbidden. Shared dependency
cleanup is reference-counted. Removal defaults to refusal when active dependents
or jobs exist; `--cascade` and scheduled drain are explicit.

The canonical publisher identity tuple is `{registry origin, normalized package
name, namespace owner/provenance identity}` plus installed content integrity.
Namespace reservation, ownership transfer, provenance-key rotation, revocation
source/freshness, and offline stale-revocation policy must be chosen before public
Tier 2 installation. A transfer/source/provenance change is a new trust decision,
never a transparent update. First-party rollback exceptions are explicit,
version-bounded, and receipt-recorded.

Generation retention uses reference leases owned by running jobs, the rollback
window, and artifacts explicitly marked reproducible. Lease creation/release is
journaled; crashes expire process leases only after fenced liveness recovery.
Quota pressure first removes unleased caches, then unleased generations outside
the rollback window. Required leased bytes are never silently deleted: the user
receives a complete size/reference report and chooses archive, release, or purge.

## Security and supply-chain clauses

- In-process executable mods are fully trusted code. Capability tokens constrain
  cooperative use of kernel APIs and produce receipts; they do not prevent direct
  Node filesystem, environment, process, or network access.
- “Sandboxed” and “isolated” are reserved for a host with an enforceable boundary.
  Worker threads alone are crash separation, not an OS security boundary.
- No-top-level-side-effects and no-private-import are author/build contracts. They
  are verified, but neither turns hostile code into trusted code.
- Manifest discovery, dependency solving, permission diffing, and package
  verification happen before executable import.
- Publisher/source, registry, tarball integrity, provenance/signature status,
  key rotation/revocation state, and requested full-code trust are visible before
  approval. Integrity proves bytes, not author trust.
- Catalog namespaces and first-party IDs are reserved against dependency
  confusion/typosquatting. An unconfigured ambient registry or `node_modules`
  directory is never an authority.
- Extraction rejects traversal, escaping symlinks, case/Unicode collisions,
  device files, unexpected executable bits, oversized files/trees, and undeclared
  assets. Every executable/static path is realpath-contained.
- Capability/grant decisions bind to package identity, content integrity,
  contribution, graph generation, and invocation. A checked token cannot be
  reused across an update or another mod.
- Global exception/rejection handling attributes owner where possible, quarantines
  the failing contribution, and preserves kernel recovery. In-process code can
  still block the event loop; this residual risk is disclosed.

## Install and update clauses

Managed mod install runs with lifecycle scripts disabled. Native/Python/WASM
requirements use declared static artifacts or explicit trusted setup actions.
A setup action is typed, previewed, separately approved, time/output/path bounded,
receipt-producing, and rollback-aware. It is not arbitrary `postinstall` under a
different name.

Kernel self-update and mod graph update are distinct transactions. Replacing a
global npm binary does not claim atomic graph rollback. The target updater stages
an immutable kernel release, validates its compatibility with the candidate
graph/state, then switches a versioned launcher pointer when platform semantics
allow. Linked development installs are reported and never overwritten.

`npx` may inspect and propose without persistence. Any persistent setup must copy
verified packages into the managed store or delegate to a compatible installed
kernel; npm's ephemeral cache path is not durable state. Offline frozen-lock mode
performs no network fallback. Proxy/private registry behavior inherits configured
npm registry/auth/proxy/CA settings without logging credentials.

## Platform matrix

The v1 release matrix covers macOS and Linux on arm64/x64 with Node >=22. Windows
is deferred; portability fixtures remain design evidence, not a supported claim.
Required supported-platform cases include:

- npm-generated bin shim versus direct Node invocation;
- path separators, spaces, Unicode, case-insensitivity, and long paths in install
  roots and persisted relative paths; drive/junction cases are deferred;
- symlink/junction behavior for linked development;
- file locking, rename/pointer switch, ACL/permissions, read-only global prefixes,
  antivirus/file-sharing contention, and crash recovery;
- shell independence (no Bash assumption in package install/setup);
- line endings and executable bits for generated launchers;
- native/Python/WASM platform selection and unsupported-platform diagnostics;
- local loopback/socket paths for daemon/MCP/browser surfaces; a future Windows
  version must specify named-pipe behavior;
- portable/alternate `$AGON_HOME` and multiple concurrent user sessions.

The Node floor and architecture cells are frozen. Minimum OS release numbers are
a release/product input. Unsupported cells fail compatibility early; they do not
partially install.

## Blast-radius matrix

| Dimension | Verified current risk | Required target evidence | Status |
|---|---|---|---|
| Static catalogs | CLI/TUI/MCP/docs/lifecycle are separate | Golden graph yields identical contribution IDs/availability across every projection | Inventory/ownership frozen; projection implementation test reserved |
| Build boundary | CLI inlines Core/Forge/Adapter/MCP | Packed kernel excludes separately selectable executable mods | Package map/kill-list frozen; implementation pending |
| Author API | No stable external Mod API | Independent example repo builds/tests without deep imports | Compile-only external example passed |
| Kernel singleton | Bundling + future peers can duplicate hosts | Runtime owns context; duplicate implementation imports rejected | Contract frozen; implementation pending |
| Resolver | Dependency rules exist; exact selection incomplete | Property tests + canonical frozen lock fixtures | Reference/property tests passed |
| Activation | Current code has no generation transaction | Sacrificial validation + immutable generation commit/recovery tests | Journal/commit contract frozen; implementation pending |
| Concurrency | Existing file locks are subsystem-specific | Cross-process mutation race/crash suite | Single-writer contract/test IDs frozen; implementation pending |
| Long-lived hosts | MCP/TUI/daemon can cache catalogs | Generation handshake, pin/drain/restart/stale-call fixtures | Policy frozen; implementation pending |
| Install scripts | Current root uses postinstall/Python | Script-free mod packs + explicit setup-action tests | Pack contract passed; migration pending |
| Global/npx/link | Current updater only recognizes linked CLI | Clean-room matrix and deterministic source precedence | Precedence/install contract frozen; implementation pending |
| Offline/proxy/private registry | Current path not hermetic | Hermetic cache test and credential-redaction proxy fixture | Semantics frozen; external fixture required at release |
| Platform support | Packages require Node >=22; CI currently runs Ubuntu/Node 22 only | Declared macOS/Linux arm64/x64 matrix with path/lock/rename/bin/native evidence; Windows deferred | Contract frozen; Linux runner receipt blocks release |
| Static/native assets | Engines duplicated; Python files special-cased | Declared asset inventory/hash/platform/ownership tests | Inventory/owners frozen; relocation pending |
| Trust/capabilities | Current extension permissions unenforced | Honest tier UX, grant binding, isolated-tier rejection | Schemas/policy frozen; implementation pending |
| Supply chain | npm integrity only | Publisher/provenance policy, namespace reservation, revocation behavior | Exact-artifact policy frozen |
| Persistence | Current shapes vary | All artifact classes + tombstone/missing-mod/downgrade fixtures | Envelope schemas/policies frozen; migrations pending |
| Disable/uninstall/purge | Data retention stated | Active job, shared dep, GC lease, cascade, purge preview tests | Semantics frozen; implementation pending |
| Config | Three scopes exist | Namespaces, schema skew, unknown retention, concurrent migration tests | User-global activation/settings contract frozen |
| Docs | Runtime docs projection proposed | Full catalog vs active view and offline generation contract | Owner/projection contract frozen |
| Performance | Lazy startup is important | Minimal/full cold start, memory, graph load, large-mod-set budgets | macOS measured and budgets frozen; Linux receipt external |
| Observability | Current receipts vary | Transaction/generation/mod ownership diagnostics, secret scan | Receipt schemas/ledger frozen |
| Release | Existing publish scripts cover CLI/dedup | Release-set/BOM, pack-install compatibility, rollback retention | Lockstep topology/gates frozen; implementation pending |
| Migration | Think-first slices exist | Kill-list for every legacy catalog/import and downgrade fixture per slice | Machine kill-list complete |
| Historical pressure tests | Existing upgrade runbook and historical modes | Sanitized representative deterministic coverage | 160-test representative suite green; live lanes remain release-gated |

This summary is backed by a required machine-readable coverage ledger. Each row
key is `(lifecycle transition, artifact/surface class)` and records the normative
clause link, responsible package/owner, verification/test ID, supported platform
environment, implementation status, and accepted/open risk. The ledger must cover
at least manifests, executables, dependency closures, static assets, catalog and
profile metadata, provenance/attestations, setup outputs, locks, current pointers,
journals, grants/trust, quarantine records, config/migration backups, tombstones,
receipts, sessions/plans/jobs/results/ratings/history, leases, GC indexes, caches,
and every runtime projection. An unowned cell blocks specification readiness; a
supported runtime cell without its required test/measurement blocks release. The
machine ledger—not this prose table—is the coverage authority.

Persisted/config contributions declare separate readable and writable schema
ranges plus pure migration edges. A downgrade may render read-only, pause, or
restore a compatible backup according to the artifact policy; it never writes a
newer schema using an older implementation.

## Failure-injection suite

At minimum, tests inject:

1. malformed/oversized/prototype-polluting manifest;
2. package name/version mismatch and duplicate case-folded ID;
3. dependency cycle, conflict, incompatible ranges, yanked/prerelease pin;
4. changed tarball with same declared version and corrupt static asset;
5. traversal, symlink escape, case collision, decompression bomb;
6. missing entry/chunk/declaration/manifest from packed tarball;
7. top-level throw, rejection, hang, timer/socket, and registration timeout;
8. registration of undeclared/colliding contribution;
9. disposer failure, leaked timer/job/subscription, event-loop stall;
10. crash before staging, during extraction, before pointer flip, after flip, and
    during cleanup;
11. two concurrent writers, stale lock, killed lock owner, slow reader;
12. daemon N versus CLI N+1, stale MCP client, TUI drain timeout;
13. disable dependency with active reverse closure and active job;
14. uninstall producer of historical result, pending plan, session, and rating;
15. downgrade kernel/state/manifest/Mod API with and without reader/migration;
16. npx cache deletion after setup, global prefix read-only, linked path moved;
17. offline cache complete/incomplete/corrupt; registry/proxy/CA/auth failure;
18. macOS/Linux spaces/Unicode/long-path/locked-file behavior; Windows
    drive/junction/locked-executable cases remain deferred portability fixtures;
19. Python absent/wrong version; native architecture mismatch; WASM corruption;
20. permission expansion, source/publisher change, revoked provenance, secret scan;
21. minimal/full/custom profile parity and generated cross-surface catalogs;
22. rollback generation missing/corrupt and safe-mode recovery.

## Evidence completed before rewrite

The following behavior-neutral evidence work is complete and did not mutate the
active installation:

1. freeze current command/TUI/MCP/Cesar/docs/event catalogs as golden fixtures;
2. inventory ownership of Core, Forge, Dedup, MCP, browser host, engines, Python,
   state stores, and every lifecycle subscriber;
3. define and property-test manifest, contribution, resolver, and canonical-lock
   schemas in memory;
4. create public Mod API prototypes and compile an external example without
   publishing or executing arbitrary third-party code;
5. generate projections from a fixture graph and compare them to legacy surfaces;
6. add pack-content and source-import boundary guards;
7. convert current pressure results into sanitized fixture coverage mapping.

The S7 implementation now provides the durable managed lifecycle, immutable candidate-prefix promotion, recovery, rollback, purge preview, and bounded setup-action contracts. It remains isolated from the active installation. Public npm/npx promotion and Tier 2 third-party execution remain subject to S8/S9 gates.

## Specification readiness closure

- [x] Deterministic resolver/source precedence and canonical lock schema frozen.
- [x] Immutable generation store, commit point, writer lock, leases, and crash
      recovery specified for every supported platform.
- [x] Long-lived surface generation/pin/drain/restart policy specified.
- [x] Public Mod API package exports, lifetimes, errors, skew, and deprecation
      policy specified and proven by an external example.
- [x] Executable/declarative package profiles, transitive dependency policy, and
      host-owned verification schema/runner semantics frozen.
- [x] Static/built/runtime file and asset ownership assigned in the ownership ledger.
- [x] Every user-facing current mode has its own target physical package; support
      packages and the minimal non-disableable kernel are explicitly enumerated.
- [x] Kernel/mod/update/setup-action boundaries accepted.
- [x] Persistence envelope and missing-mod policy accepted for every artifact.
- [x] Supply-chain publisher/provenance/revocation policy accepted.
- [x] Safe-mode corruption selection, generation leases/retention/quota, and
      schema read/write downgrade behavior accepted.
- [x] Supported Node/architecture matrix selected; minimum OS release labels remain
      a release/product choice and Windows is deferred.
- [x] Machine-readable lifecycle/artifact ledger has no unowned cells; macOS
      cold-start/memory/graph/TUI budgets are measured and Linux cells name the
      unavailable external runner.
- [x] Legacy codepath migration kill-list and required downgrade fixture IDs complete.
- [x] Test matrix has owners/environments and every row maps to an evidence ID.
- [x] Isolated-prefix candidate qualification, production-state fixture, promotion
      re-test, and rollback have a frozen procedure/receipt contract; executing
      them is an implementation/release gate because no production rewrite exists.

The final adversarial/model reviews and local verification receipt are linked from
the contract index. Passing specification evidence authorizes implementation, not
release; production code must still satisfy schemas, property tests, pack tests,
failure injection, platform cells, and live workflow gates.
