# Modular Agon acceptance roadmap

**Status:** implementation in progress; release acceptance remains unproven
**Date:** 2026-10-13 (source observations at `624af51e` plus uncommitted qualification work; historical diagnostics below retain their original subjects)

The original plan was frozen on 2026-08-23. Raphael subsequently authorized
implementation in an isolated worktree. This status update does not authorize
installation, promotion, or changes to the active/global Agon.

The machine source of truth is
[`evidence/modular-agon-implementation-roadmap.json`](./evidence/modular-agon-implementation-roadmap.json).
Run `node scripts/spec/verify-modular-agon-roadmap.mjs` to prove that it covers
49 packages, 153 unique dependency edges, all 872 frozen legacy ownership assignments,
existing source paths, topological order, nine gated slices, and classified
claims.

## Current truth

| Capability | State |
|---|---|
| Public API, manifest validator, resolver, registry, compatibility metadata | implemented |
| Slice 1A acceptance | original receipt [superseded](./evidence/modular-agon-slice1a-audit-supersession.md); current clean-subject acceptance remains unproven |
| 49-package DAG | implemented structural map: 153 declared and unique edges; roadmap dependency sets match the package map, including Plan's approved worktree dependency |
| Durable host/state/profiles/activation | implementation exists; current-subject slice qualification still required |
| Physical extraction beyond API/kernel | partial: physical packages exist; remaining ownership and host adapters are not retired |
| Runtime-generated CLI/TUI/MCP/Cesar/docs | partial: executable generated activation exists; complete legacy-owner retirement is not proven |
| Installer/update/rollback/safe mode | implementation exists; fresh-install and release qualification remain incomplete |
| Managed lifecycle recovery and purge | partial: explicit `mod recover transactions` calls kernel recovery; nine real SIGKILL boundaries pass through the built safe-mode CLI on local macOS arm64. The purge API journals quarantine/removal and passes three real process-kill replay cases. `mod purge` now previews exact targets and requires a saved-plan hash; built safe-mode CLI tests cover refusal, removal and replay without deleting replacement data. Lease-aware retention, full purge reporting and release qualification remain unfinished. This development evidence is not clean release qualification |
| Trust/grants/third-party folder mods | implementation exists; complete security/release acceptance remains unproven |
| npm/npx release | candidate machinery exists; not a qualified or promoted release |
| Native release/signing/publish evidence | externally blocked |
| Future preset composition/default-enabled policy | future product decision |

These are source-state observations, not accepted slice receipts. The JSON claims
link implementation evidence and state the limits of each conclusion. Structural
roadmap validation checks coverage; it does not prove the truth of prose, runtime
ownership, or release readiness. Remaining implementation and qualification work
must satisfy the unchanged criteria below.

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

The read-only committed-subject diagnostic is
`node scripts/spec/qualify-modular-agon-clean-checkout.mjs --subject=commit`.
On `f11c6602` it reports equal index/commit hashes, no source contamination, and
151 unique dependency edges. It remains red: stored review evidence has a subject
mismatch and no clean-checkout steps ran. The original TS7016, ignored declaration,
duplicate-edge, and dirty-index findings remain historical evidence in the
supersession record; they are not the diagnostic observed at `f11c6602`.

Adding `--run-clean` performs a clean dependency installation and qualification.
It requires installation authority. The current staged goal permits frozen
lockfile installs only in disposable candidate prefixes with isolated homes and
caches, with lifecycle scripts disabled. It does not authorize global installs,
new dependencies, or promotion of the active installation.
Neither a read-only diagnostic nor a previous subject's passing tests replaces
that gate. `node scripts/spec/assess-modular-agon-slices.mjs` separately checks
availability of each slice's commands and committed receipt requirements.
The assessor reads the roadmap, commands and receipts from one pinned evidence
commit. It rejects dirty worktrees and source-bearing ignored files.

Slice receipts use schema 2: `subjectCommit` identifies the tested commit;
`subjectHash` binds its Git paths, modes and object IDs. The current evidence
commit must descend from that tested commit and have the same subject hash.
Only the nine exact `docs/specs/evidence/receipts/modular-agon-s1b.json` through
`modular-agon-s9.json` receipt paths are excluded. No source, fixture, review or
other evidence directory is excluded. A receipt-only follow-up commit can thus
record results without circularly changing the tested subject. Untracked or
staged-only receipts cannot qualify a slice. Old schema receipts require fresh
qualification; changing their version field is not verification.
Each schema-2 receipt also records `prerequisites`, an object from required slice
ID to its exact Git receipt-blob ID. Those blobs must exist at the tested commit
and remain unchanged at the evidence commit. Replacing a prerequisite receipt
requires dependent requalification. The assessor requires all nine ordered slices
with their agreed predecessor dependencies and nonempty command lists. An empty
or shortened roadmap cannot report success.
Subject paths use UTF-8 byte ordering, not the machine's locale. Old digests
must be regenerated through qualification if their ordering differs. Ignored
dependency/build outputs are exempt only at root `node_modules/` and immediate
`packages/<name>/{node_modules,dist,dist-tsc}/` locations. A directory named
`dist-custom` or `node_modules` under source does not hide source contamination.

All nine clean-checkout qualifiers pin the commit and index tree before hashing,
review validation or execution. Review inputs use policy `modular-review-input-v2`,
with the policy and slice ID included in the hash domain. This projection omits
only the nine exact S1B–S9 review manifests and nine aggregate receipt paths,
in addition to the existing slice-specific verification receipt and S4–S9 log
exclusions. Source, fixtures, unknown evidence and other review artifacts remain
bound. Manifests cannot select exclusions. The aggregate schema-2 projection
above is unchanged: it binds every review manifest and artifact. The aggregate
assessor also validates every current slice review, including policy, findings,
distinct completed engines and artifact hashes.

Historical reviews are not silently migrated. The new policy requires fresh
review or explicit reviewer reaffirmation. Finalize review artifacts first,
seal all nine manifests, then freeze the aggregate subject. Run and record each
slice in dependency order, committing only its aggregate receipt. Keep fresh
command logs outside the tree during this chain. Any other content change
requires fresh qualification; a replaced prerequisite requires dependent reruns.

All nine clean-checkout qualifiers pin the commit and index tree before hashing,
review validation or execution. Receipts identify the pinned revision and tree;
an index subject keeps its distinct `kind: index` label. Materialization reads
raw Git blobs, preserves executable modes, and verifies exact bytes and paths
before qualification commands run. Archive attributes, checkout filters, later
HEAD movement and later index changes cannot substitute another tested tree.
The same mechanism materializes the rollback parent for S4–S7. Symlinks,
submodules, unexpected files/directories and `.git` indirection are rejected.
Git paths must round-trip through UTF-8; invalid filename bytes are rejected
before writing, not replaced. Qualification history imports blobs without clean
filters and constructs the index from pinned paths, modes and object IDs. Both
the index tree and resulting commit tree must equal the pinned tree. This also
applies to rollback parents, so attribute-driven normalization cannot change
the version used for rollback checks.
The bounded Git batch limit is 64 MiB; exceeding it fails qualification rather
than truncating or accepting incomplete files.

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

The platform checker defaults to diagnostic evidence. `--native-runner` records
the runner operator's attestation that execution is native, not under Rosetta,
emulation, or a container. It does not detect hardware or prove that attestation.
Retain the runner inventory/job evidence with the qualification receipt. The S9
qualifier forwards this flag to its clean-checkout platform check and requires
fresh native-attested results for Node 22, 24, and 26; an old stored matrix or a
diagnostic run cannot satisfy that gate. Use `--no-write --json` on the platform
checker to inspect full results without replacing tracked evidence. Standalone
matrix output is not a source-bound release approval.

Release requires S1B–S9 clean receipts; 49 packages/153 edges/872 frozen legacy assignments;
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
