# Modular Agon acceptance roadmap

**Status:** implementation-ready plan; production extraction is not authorized
**Date:** 2026-08-23

The machine source of truth is
[`evidence/modular-agon-implementation-roadmap.json`](./evidence/modular-agon-implementation-roadmap.json).
Run `node scripts/spec/verify-modular-agon-roadmap.mjs` to prove that it covers
49 packages, 144 unique dependency edges, all 849 staged-subject legacy ownership assignments,
existing source paths, topological order, nine gated slices, and classified
claims.

## Current truth

| Capability | State |
|---|---|
| Public API, manifest validator, resolver, registry, compatibility metadata | implemented |
| Slice 1A acceptance | partially implemented; red and [superseded](./evidence/modular-agon-slice1a-audit-supersession.md) |
| 49-package DAG | partial: IDs exist; authoritative input still has four duplicate entries |
| Durable host/state/profiles/activation | specified only |
| Physical extraction beyond API/kernel | specified only |
| Runtime-generated CLI/TUI/MCP/Cesar/docs | specified only; current projections are metadata |
| Installer/update/rollback/safe mode | specified only |
| Trust/grants/third-party folder mods | specified only |
| npm/npx release | specified only |
| Native release/signing/publish evidence | externally blocked |
| Future preset composition/default-enabled policy | future product decision |

No locally answerable architecture question remains. “Specified only” denotes
implementation work, not an unresolved decision.

## Dependency-ordered slices

| Slice | Outcome | Depends on |
|---|---|---|
| S1B | truthful clean-checkout evidence and raw legacy oracle | — |
| S2 | durable immutable-generation host and safe mode | S1B |
| S3 | desired state, profiles, activation and dependency-aware UI | S2 |
| S4 | eleven shared packages, API compatibility, foundation mutation gate | S3 |
| S5 | thirty-six first-party mod packages and disable matrix | S4 |
| S6 | one generated runtime registry for all five surfaces | S5 |
| S7 | first-party install/update/rollback and filesystem fault injection | S6 |
| S8 | trust, grants and third-party folder mods | S7 |
| S9 | npm/npx, native macOS/Linux and persisted-state migration release | S8 |

Every JSON slice freezes entry criteria, exit criteria, acceptance commands,
evidence IDs, and rollback/re-entry. A later slice consumes the prior clean
committed receipt; prose completion is never an entry gate.

## Package and migration freeze

Each of the 49 JSON package records freezes its physical owner, de-duplicated
dependencies, public/private boundary, existing extraction source paths,
topological migration order, compatibility adapter, removal IDs, and boundary,
parity, pack, and disabled-surface evidence. Extraction introduces a boundary
behind an adapter, proves parity and disable behavior, switches ownership, then
removes the legacy path. It never combines move, cutover, and deletion as one
unrecoverable operation.

## Blast radius

| Area | Main failure | Required evidence | Rollback unit |
|---|---|---|---|
| API/manifest | incompatible authors or unsafe discovery | schema negatives, type baseline, N−1/N−2 | API/package version |
| resolver/lock | wrong graph or nondeterminism | permutation, mutation, canonical lock | prior lock |
| host/state | torn/mixed generation | crash, concurrency, journal replay | generation pointer |
| profiles/UI | wrong dependency visibility/state | parent-child matrix, snapshots, reachability | desired-state revision |
| support/mod extraction | broken dependants/private imports | boundary, parity, pack, workflow matrix | per-package adapter |
| surface cutover | CLI/TUI/MCP/Cesar/docs drift | generated parity, disabled unreachability | registry generation |
| lifecycle | damaged installation | kill-point, ENOSPC/EACCES, offline rollback | qualified prefix |
| trust/folder mods | unintended code/capability | hostile fixtures, grant invalidation, containment | first-party safe mode |
| release | fresh/upgrade/platform divergence | pack/npx/native/upgrade matrix | corrected forward release |

## Acceptance and rollback rules

- Release receipts hash committed Git objects; staged-index hashes are explicitly
  distinct. Ambient working-tree bytes cannot define a subject.
- Source-bearing ignored/untracked files, dirty release subjects, duplicate
  edges, non-relative review artifacts, and hash mismatch make the gate red.
- The legacy oracle captures raw persisted result/event envelopes before
  extraction. Redaction, normalization, formatting, and rendering are separately
  tested transformations.
- Each slice proves exit, rollback, previous-generation operation, re-entry, and
  exit again. A zero exit code from a rollback command is insufficient.
- Immutable generations/prefixes are selected atomically and never rebuilt in
  place. Safe mode loads only recovery kernel surfaces.
- Third-party activation stays fail-closed through S7 and begins only after S8
  trust/grant gates pass.
- Removal requires its kill-list guard plus zero remaining imports, generated
  owners, assets, config/state readers, or documentation owners.

The executable staged-index diagnostic is
`node scripts/spec/qualify-modular-agon-clean-checkout.mjs --run-clean`. Its
current expected result is red: clean install passes, `mod-api` build fails
TS7016, two ignored declaration files are detected, four duplicate edges are
reported, and the staged index differs from `HEAD`.

## Platform and release matrix

| Target | Development evidence | Release evidence |
|---|---|---|
| macOS arm64/x64 | native or explicitly labelled compatibility diagnostics | native clean runners required |
| Linux arm64/x64 | containers/emulation explicitly labelled diagnostic | native clean runners required |
| Node 22/24/26 | compile, contracts, install/upgrade | required while `engines.node` remains `>=22` |

Emulation is never relabelled native. V1 ships npm/npx packages, not a separate
notarized macOS application or systemd service; shipped native helpers still need
architecture and integrity evidence. Signing/publishing credentials, registry
rehearsal, and unavailable native runners are genuine external blockers.

Release requires S1B–S9 clean receipts; 49 packages/144 edges/849 staged-subject assignments;
all enable/disable/dependency/failure/rollback cases on five surfaces; complete
kill-list removal; install/update/interruption/downgrade/offline/safe-mode tests;
content-bound trust/grants; minimal pack contents; native performance budgets;
reproducible independent review with no locally fixable finding; and proof that
the active/global Agon was never the qualification target.

## Resolved and deferred decisions

Resolved: user-global activation; profiles are named desired-state lists;
bundled first-party mods default enabled; children require parents but not the
reverse; disabled built-ins remain visible and grey; changes apply to new
sessions; macOS/Linux are v1; physical packages and deterministic load order are
required; edited third-party content invalidates prior grants.

Deferred product choices: later optional preset composition and whether a future
major changes default-enabled mods. These do not block v1. External evidence:
native release runners, signing/publishing credentials, and npm release rehearsal.

Review adjudications: [Brainstorm](./evidence/modular-agon-roadmap-brainstorm-adjudication.md)
and [Tribunal](./evidence/modular-agon-roadmap-tribunal-adjudication.md).
