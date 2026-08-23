# Modular Agon Slice 1A implementation

**Status:** ACCEPTANCE GATES GREEN IN ISOLATED NON-SHIPPING WORKTREE
**Date:** 2026-08-22
**Branch:** `feat/modular-agon-slice-1a`

## Outcome

Slice 1A adds behavior-neutral modular plumbing. The existing CLI, TUI, MCP,
Cesar, browser, daemon, and workflow implementations remain authoritative and
unchanged. No external mod is imported or executed. No managed store, grant,
trust, install, activation, or global state is created.

The implementation consists of:

- `@kernlang/agon-mod-api`: the standalone public ESM/type protocol, strict
  manifest v2 validator, and versioned executable schemas;
- `@kernlang/agon-kernel`: the non-shipping static discovery checks,
  deterministic resolver, canonical in-memory lock builder, owner-tagged
  registry, target package DAG, and compatibility projections;
- generated compatibility catalogs derived from the frozen inventory and
  ownership ledger rather than a new handwritten list;
- executable boundary, resolver, registry, parity, package, static discovery,
  and performance gates.

## Boundary decision

The frozen generated package map listed `@kernlang/agon-mod-api` as depending on
`@kernlang/agon-kernel`, while the normative author contract says the public API
must contain no kernel runtime, singleton, or private imports. The implementation
uses the stricter author boundary: the API is standalone and the kernel foundation
consumes the public API. This prevents a mod from acquiring or installing a second
kernel instance through its protocol dependency. The frozen 49-package product map and its generator now encode that corrected
direction: the public API has no dependencies and the kernel depends on it. This
contract is verified before any later physical extraction.

## Contracts implemented

### Static manifest boundary

- strict unknown-field rejection and manifest schema version 2;
- executable/declarative profile rules;
- semver validation for API, kernel, Node, and dependency ranges;
- canonical ID, relative path, duplicate, self-dependency, conflict, asset, and
  contribution checks;
- bounded JSON reads, realpath containment, lexical traversal refusal, absolute
  path refusal, and symlink-escape refusal;
- no entrypoint import during discovery.

### Deterministic resolver

- source precedence: explicit development, user folder, registry, bundled;
- same-precedence collision refusal;
- provenance protection for reserved `agon.*` IDs; the resolver consumes a
  host-verified provenance verdict but does not create trust evidence in Slice 1A;
- one version per ID with constraint solving across required ranges;
- stable preference for the highest eligible version;
- exact/opt-in prerelease handling, frozen-only yanked handling, and explicit
  downgrade authority;
- exact platform/API/kernel/Node compatibility;
- closed desired set, conflicts, complete cycle paths, optional integrations,
  reverse dependencies, and canonical topological order;
- an explicit strict-normalization phase so graph solving receives the normalized
  input required by the frozen contract without repeatedly cloning manifests.

### Registry and projections

The registry owns one immutable generation and tags every record with the active
mod identity. It enforces declarations, aliases, collisions, reserved IDs,
registration sealing, owner-scoped reverse disposal, and disabled-owner
unreachability.

The compatibility generator maps 441 current occurrences into five projections:

| Projection | Occurrences |
|---|---:|
| CLI | 69 |
| TUI (slash, keyboard, metadata, intents) | 237 |
| MCP | 33 |
| Cesar (tools and routes) | 99 |
| generated docs | 3 |

Every generated occurrence retains its current public ID, source location,
physical target owner, and ownership class. Tests compare the generated set to
the frozen source inventory and ownership ledger. The compatibility adapter is
metadata-only; dispatch continues through legacy code.

## Repeatable gates

```bash
npm run test:modular-slice1a
npm run perf:modular-slice1a
npm run typecheck
npm run lint
npm run guard:reexports
npm run build
npm test
```

`test:modular-slice1a` is clean-clone safe: it builds both new packages before
checking generator drift, the 49-package/144-edge DAG, package contents,
external public-API compilation, the frozen contract suite, and all Slice 1A
unit/property tests. The final qualification receipt is
[`evidence/modular-agon-slice1a-verification-receipt.json`](./evidence/modular-agon-slice1a-verification-receipt.json);
it records 376 repository test files with 5,477 passing tests and 6 skips, plus
the frozen 160/160 representative workflow suite. Independent review findings
and evidence-backed dispositions are recorded in
[`evidence/modular-agon-slice1a-review-adjudication.md`](./evidence/modular-agon-slice1a-review-adjudication.md).
## Measured platform evidence

The macOS receipt is
[`evidence/modular-agon-slice1a-performance.json`](./evidence/modular-agon-slice1a-performance.json).
The measured `darwin-arm64` run is green against every frozen local budget:

- CLI cold p95: 166.0 ms or less (budget 185 ms); peak RSS p95: 96.7 MB or less (budget 124 MB);
- normalized 1,000-candidate resolver p95: 30.1 ms; maximum retained heap delta: 0.7 MB;
- 441-entry projection construction p95: 0.39 ms;
- compatibility aggregate: 1.64 MB packed, 8.17 MB unpacked, 227 files;
- 300-block TUI input p95: 3.79 ms (budget 12 ms).

The isolated Docker `linux-arm64` receipt is
[`evidence/modular-agon-slice1a-performance-linux-arm64.json`](./evidence/modular-agon-slice1a-performance-linux-arm64.json).
It is green at 148.5 ms cold p95, 89.2 MB RSS p95, 44.5 ms resolver p95,
11.58 ms TUI p95, and the same package ceilings. Clean installs and all 77
Slice contracts also pass on Linux arm64 and emulated Linux x64. The same 77
contracts pass on Node 22.23.2, 24.19.0, and 26.3.0, plus Darwin x64 under
Rosetta. Native x64 performance remains a release-runner receipt, not a claimed
local measurement; the complete matrix is recorded in
[`evidence/modular-agon-slice1a-platform-matrix.json`](./evidence/modular-agon-slice1a-platform-matrix.json).
Linux-specific implementation and does not weaken that release gate.

## Explicitly not implemented

- no durable desired state, lock selection, generation pointer, journal, trust,
  grants, installer, updater, rollback, or purge;
- no third-party executable activation or import;
- no first-party mode extraction or package publication;
- no runtime consumer cutover from legacy dispatch to the generated registry;
- no stale-host generation handshake or long-lived host reload;
- no claim that Slice 1B, Slice 2 runtime cutover, or later slices are complete.

These exclusions are deliberate. They preserve the frozen migration boundary and
keep the active/global Agon untouched.
