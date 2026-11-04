# Modular Agon frozen v1 contracts and evidence index

**Status:** IMPLEMENTATION-READY CONTRACT BASELINE
**Date:** 2026-08-22

This document is the normative index for the executable contract artifacts.

The non-shipping Slice 1A implementation and measured qualification are indexed
in [`modular-agon-slice1a-implementation.md`](./modular-agon-slice1a-implementation.md). The
other Modular Agon documents explain architecture, security, authoring, migration,
and blast radius. If an illustrative snippet differs from an executable artifact,
the executable artifact named here wins and the discrepancy is a specification
defect.

## Current-surface freeze

The reproducible inventory generator is
[`scripts/spec/generate-modular-agon-inventory.mjs`](../../scripts/spec/generate-modular-agon-inventory.mjs).
Its canonical output is
[`evidence/modular-agon-current-inventory.json`](./evidence/modular-agon-current-inventory.json).
The frozen working-tree inventory contains 69 CLI command/subcommand entries, 73
TUI slash entries, 53 built-in command metadata entries, 68 intent variants, 33
MCP tools, 29 Cesar tools, 70 Cesar route values, 12 configured lifecycle hook
kinds, 29 emitted event sites, 142 exported result/session/plan/receipt/event
declarations, 122 config keys, 43 state-path occurrences, 30 persistence/state
store modules, 18 packaged/static artifacts, 15 Python/native components, and 3 generated-documentation entry
points. The TUI inventory separately records 73 slash actions and all 43
non-slash keyboard action variants.

Counts include distinct source occurrences where two catalogs currently repeat an
ID. That is intentional evidence of duplication, not a claim that the public IDs
are unique today. The migration must reconcile CLI/TUI/metadata/intent divergence
through one manifest projection. In particular, `pipeline` currently denotes
brainstorm→forge→tribunal in MCP metadata but build→review→fix in the TUI. V1 gives
those workflows separate canonical IDs while preserving the existing alias on
each compatibility surface.

## Ownership, physical packages, UI, and kill-list

The generated ownership ledger assigns every inventory occurrence to exactly one
of the three permitted classes:

- minimal kernel machinery;
- a hidden shared support package; or
- a physical user-toggleable mod package.

The canonical files are:

- [`evidence/modular-agon-ownership.json`](./evidence/modular-agon-ownership.json);
- [`evidence/modular-agon-package-map.json`](./evidence/modular-agon-package-map.json);
- [`evidence/modular-agon-ui-hierarchy.json`](./evidence/modular-agon-ui-hierarchy.json); and
- [`evidence/modular-agon-migration-kill-list.json`](./evidence/modular-agon-migration-kill-list.json).

The v1 map contains 49 physical packages: 2 kernel/API packages, 11 hidden support
packages, and 36 user-toggleable mods. First-party release versions are lockstep
in v1 even though the manifest, lock, Mod API, verification, and persisted-payload
schema versions remain independently declared. Hidden support packages never
appear as top-level toggles. Their advanced dependency rows are derived from the
same DAG.

## Frozen resolver and source rules

The pure reference resolver lives in
[`contracts.mjs`](./fixtures/modular-agon-contracts/contracts.mjs) and is covered
by permutation, collision, missing-dependency, conflict, and cycle tests.

V1 rules are:

1. Canonical mod IDs are lowercase ASCII dotted/dashed IDs. Uppercase, Unicode,
   normalization-dependent, npm-package-style scoped IDs, and aliases are rejected
   as canonical mod IDs. npm package name and canonical mod ID are separate fields.
2. Reserved `agon.*` first-party IDs can only be supplied by the allowlisted
   first-party publisher/source, except an explicitly selected development path.
   A normal folder mod can never shadow one.
3. Candidate source precedence, highest first, is `explicit-dev`, `user-folder`,
   `registry`, then `bundled`. The selected source and canonical locator are locked.
   Existing committed generations are not a precedence level: frozen mode reads
   the exact lock or fails with the complete missing/corrupt set.
4. Two candidates for the same ID and version at the same precedence are an
   error; multiple distinct registry versions form the candidate set. Lower-precedence candidates are reported as
   shadowed and never silently merged.
5. There is one version per canonical ID. Non-frozen registry resolution chooses
   the highest non-yanked stable version satisfying every range. Prereleases
   require an exact pin or explicit prerelease opt-in. A yanked version is usable
   only from an existing frozen lock or retained rollback generation. Downgrades
   require an explicit previewed transaction.
6. A resolver input is a closed desired set. Missing required dependencies,
   conflicts, or cycles fail. The enable command may compute and preview a required
   closure, but the resolver never silently edits desired state.
7. Required dependencies topologically precede dependents. Unrelated ready nodes
   sort by canonical ID. Optional edges do not affect activation order. No manual
   load order exists in v1.
8. Platform matching is exact over `darwin-arm64`, `darwin-x64`, `linux-arm64`,
   and `linux-x64`. Unsupported packages fail before import. Windows is portable
   design work, not a supported v1 cell.
9. Canonical lock JSON uses RFC 8785-compatible key ordering/number/string
   serialization and SHA-256 `sha256:<lowercase hex>`. Timestamps and transaction
   generation numbers live in journals/receipts, not canonical lock bytes. Equal
   normalized inputs therefore produce byte-identical locks and `graphHash`.
10. Ambient `node_modules`, project folders, current working directory, shell
    order, filesystem enumeration order, and network fallback never participate
    unless represented by an explicit normalized input.

## Executable v1 contracts

The public compile-only TypeScript contract is
[`mod-api.ts`](./fixtures/modular-agon-contracts/mod-api.ts). Mod API v1 is an
ESM/type protocol: a factory returns an `AgonModV1`, `activate()` receives one
host-owned registrar and capability services, and every registration returns an
owner-tagged disposer. Cancellation uses `AbortSignal`; streaming is a
consumer-driven `AsyncIterable<OutputEvent>`; errors use stable codes plus
retryability; state, engine dispatch, receipts, logging, and permissions cross
host-owned interfaces only. The host disposes in reverse registration and reverse
dependency order under a bound timeout. Late registration and use after disposal
fail.

The manifest is schema version 2 because current extensions already used a v1
shape; “v1” here means the first public Modular Agon contract set. The lock,
journal, trust, grant, verification, and envelope schemas begin at schema version
1. Generated Draft 2020-12 JSON Schemas are in [`schemas/`](./schemas/):

- manifest;
- canonical lock;
- transaction journal;
- trust record;
- grant record;
- verification contract and receipt;
- plan, result, session, and job envelopes; and
- lifecycle × artifact coverage ledger.

Canonical positive/negative fixtures are under [`fixtures/`](./fixtures/). The
external example at
[`fixtures/modular-agon-contracts/example-mod`](./fixtures/modular-agon-contracts/example-mod)
compiles against only the public TypeScript contract. Pack verification creates a
temporary package and proves that only the manifest, package metadata, runtime,
and declaration files are emitted. These are evidence prototypes and are not
loaded by the active Agon installation.

## Persistence and transaction rules

The canonical lock is immutable resolved-graph state. It contains exact package
identity, source/locator, content and manifest hashes, platform, dependencies,
trust/grant record IDs, deterministic resolution order, desired-state hash, and
graph hash. It contains no secrets, timestamps, or mutable transaction state.

Every mutation uses one journal with `preparing → verified → committed` or
`failed/rolled-back`. The operation enum includes graph/profile, grant/trust,
setup, rollback, purge/GC, and kernel-switch mutations. Base/candidate generation,
fence token, and previous/candidate lock hashes bind recovery.
Commit is the atomic current-generation pointer switch; cleanup occurs afterward.
Trust binds source, locator, version, manifest hash, content hash, scope, and an
explicit decision. Grants bind the exact content hash, capability, resources, and
decision, local granting principal, reason, and revocation time. Changed executable bytes invalidate both exact-artifact trust and grants;
an explicit development-path trust record remains visibly full-trust but grants
are still recomputed when requested capabilities change.

Plan/result/session/job records all use the common identity/time/owner content
hash/kernel/graph/contribution/session/trace/payload-version/encoding/receipt
envelope. Unknown payloads stay byte-preserved and remain
generically readable. Missing executable readers can enhance neither rendering nor
execution; they never trigger downloads. Plans pause, results use stored generic
snapshots, sessions retain tombstones, and running work continues only on a leased
pinned generation.

Verification checks declare host/mod authority, kind, command where applicable,
timeout, output bound, platform, and expected evidence. Host-owned checks cannot
be replaced by a mod. Receipts bind contract and subject hashes plus the runner's
ID, version, and content hash; every check records status, exit, duration, and
evidence hashes.

## Performance baseline and v1 budgets

The reproducible isolated measurement is
[`evidence/modular-agon-performance-baseline.json`](./evidence/modular-agon-performance-baseline.json).
On the measured `darwin-arm64` machine, Node v26.3.0, the rebuilt 0.2.5 candidate
recorded 140–148 ms p95 for version/help/lazy-mode help, 96–99 MB p95 peak RSS,
1.58 MB compressed / 7.42 MB unpacked / 197 files, 160 representative workflow
tests green in about 25 seconds, and 8.84 ms p95 input latency with a 300-block TUI
transcript. The 1,000-candidate resolver measured 23.3 ms p95 with a 15.4 MB
maximum observed heap delta. Final repository qualification passed all 366 test
files: 5,439 tests passed and 5 were skipped by their declared conditions.

V1 release budgets are:

| Gate | macOS | Linux |
|---|---:|---:|
| Full-profile one-shot cold p95 | ≤185 ms and ≤1.25× platform monolith baseline | ≤200 ms and ≤1.25× measured Linux monolith baseline |
| Kernel/recovery one-shot cold p95 | ≤160 ms | ≤175 ms |
| Full-profile peak RSS p95 | ≤124 MB and ≤1.25× baseline | ≤128 MB and ≤1.25× measured Linux baseline |
| 1,000-candidate resolve p95 | ≤100 ms, ≤16 MB observed heap delta | same |
| 300-block TUI input p95 | ≤12 ms; App ≤0.10 and input leaves ≤1.10 renders/key | same |
| Recommended full-profile aggregate pack | ≤1.98 MB compressed, ≤9.28 MB unpacked, ≤250 files | same bytes/files |
| Representative offline suite | ≤32 s and no failed case | ≤35 s and no failed case |

Absolute ceilings prevent a slow new baseline from normalizing a regression;
relative ceilings account for platform variance. Linux has no available local
runner in this environment, so its platform-local baseline and native/path/lock
receipts are a genuine external-system blocker. The budgets are frozen; Linux
release qualification remains red until those measurements exist.

## Coverage and verification receipts

The generated
[`lifecycle × artifact ledger`](./evidence/modular-agon-lifecycle-artifact-ledger.json)
contains 1,480 cells: 20 lifecycle stages × 37 artifact classes × macOS/Linux.
Every cell has an owner, normative clause, evidence/test ID, platform, and status.
Normative non-mutating cells are marked `specified` rather than silently omitted.
Linux runtime cells blocked on
the absent runner are visible and do not invalidate the locally complete contract
work; they block a release claim, not specification implementation readiness.

Verification commands and their bound outcomes are recorded in
[`evidence/modular-agon-verification-receipts.json`](./evidence/modular-agon-verification-receipts.json).
Generated evidence must be regenerated and diffed whenever a relevant source or
contract changes.
