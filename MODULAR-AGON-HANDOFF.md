# Modular Agon: start here

Updated 2026-10-24. For Nico and the AI helping him.

## Short answer

This is a working development implementation, not an accepted release. It is not
an empty scaffold or a completely broken rewrite. It also is not finished.
The objective remains fully modular Agon with existing workflows preserved.
Passing tests does not establish that there are no bugs.

Raphael requested publication of all current work and development evidence.
This publication is a WIP handoff, not release approval or installation approval.
The active/global Agon installation has not been replaced by this work.

## What the numbers mean

| Measure | Verified status at this handoff |
|---|---|
| Physical target packages | 49 exist and are represented in the release-set check |
| Package-map dependency edges | 158 unique edges in the checked structural map |
| Frozen legacy ownership assignments | 872 assignments to reconcile; NOT 872 proven retired owners |
| Latest full local test run | 11,406 passed, 6 skipped; 680 files passed, 1 skipped |
| Latest Council native probes | 18 passed: 7 session, 6 CLI, 5 nested MCP-host processes |
| Fresh release acceptance on this exact snapshot | Not established; do not mark any of the nine final slice receipts accepted from these working-tree results |
| Remaining closure groups below | 6; these are work groups, NOT six bugs or a completion percentage |

There is no reliable total count of unfinished individual defects. One Synthesis
winner defect is reproduced below; three new Council review findings still need
adjudication. Do not translate package counts or test counts into percent done.

## What has been built

These eight implementation areas exist. This is an inventory, not eight signed-off
release milestones. Read the source and tests before changing their contracts.

1. Public Mod API, manifests, deterministic resolver and owner-tagged registry.
2. Durable generations, desired state, profiles and activation/deactivation.
3. Physical support/mod packages and generated CLI/TUI/MCP/Cesar/docs surfaces.
4. Transactional lifecycle, recovery, safe mode and retained-generation machinery.
5. Trust/grants, folder-mod discovery and capability checks.
6. Packaging, release-set/SBOM generation, isolated installation and qualification tools.
7. Many workflow ownership migrations: Forge, Plan, Brainstorm, Goal, Tribunal,
   team workflows, Conquer, Campfire and Think have received implementation and
   contract repairs. This does not mean every compatibility binding is retired.
8. Council now has an owned runtime, command/presentation and session workflow;
   the old CLI command and TUI handler are removed, with frozen source fixtures.

The chronological implementation log is
[the product audit](docs/specs/modular-agon-product-audit.md).
It contains source locations, fixes, tests, review outcomes and limitations.
Older entries describe their recorded subjects, not necessarily today's state.

## What remains: six closure groups

| Group | Concrete remaining work | Completion evidence |
|---|---|---|
| 1. Council review | Verify the three findings below, fix confirmed defects, retain regression evidence | Independent review adjudication and fresh affected gates |
| 2. Synthesis ownership/parity | Replace divergent legacy/physical algorithms with one owner; preserve original behavior except demonstrated defects; fix parser and job cancellation | Frozen oracle, discriminating parser tests, native command/session tests |
| 3. Ownership and adapter retirement | Reconcile all 872 assignments and kill-list entries; distinguish public compatibility from duplicate execution; trace Plan/Brainstorm/Apply and remaining workflows | Source-level consumer evidence, boundary and disabled-mod checks, truthful ledger |
| 4. Installed-product acceptance | Qualify one clean committed subject through fresh install, upgrade/downgrade, rollback/re-entry, offline, safe mode, uninstall and folder mods | Fresh subject-bound receipts, not ambient working-tree test logs |
| 5. Complete quality/security gates | Full original workflow corpus, mutation, load/performance, accessibility, dependency findings and supply chain on that same subject | Current gate results and known-finding disposition; no weakened tests |
| 6. Release/platform evidence | Finish available native Node/platform cells; explicitly retain unavailable native runners and publishing/provenance as external | Platform matrix with real native evidence; no container evidence called native |

These are the existing acceptance requirements, not a new feature wish list.
The full contracts live in [the roadmap](docs/specs/modular-agon-acceptance-roadmap.md)
and [its machine-readable version](docs/specs/evidence/modular-agon-implementation-roadmap.json).
Some older prose/claim states lag later fixes. Verify them against source and the
dated product audit; do not use stale OPEN text as proof that a feature is absent.

## Known defects and new review findings

**Reproduced Synthesis defect:** the compiled physical command receives
`SCORE_1: 10`, `SCORE_2: 90`, `WINNER: Entry 2` for engines alpha/beta, but returns
alpha. The legacy parser returns beta. The physical implementation also differs
in swap pairing, prompts and score shape. Existing physical tests do not prove
legacy parity. See `packages/mod-synthesis/src/implementation.ts` and
`packages/forge/src/synthesis-modus.ts`. Do not confuse this with Forge's separate
`synthesis.ts` helper. The fallback session handler also owns a separate abort
controller; trace the actual job signal during the migration.

**Council independent review, not yet adjudicated:**

1. Session rejects one advisor plus an external chairman before forming the effective roster.
2. Failed advisors can leave a successful verdict labelled `degraded: false`.
3. Non-CLI output gives quiet precedence over JSON, unlike CLI presentation.

These are reviewer hypotheses, not three confirmed regressions. Check inherited
behavior and consumers before fixing. The review ran through isolated Agon/Codex
after Raphael approved the exact source packet. Raw packet, response and hashes
are in the evidence export. The previous approval blocker is no longer pending.

**Dependency security:** the recorded OSV scan has unresolved findings, including
two CVSS 9.5 advisories for dev dependency tinypool 1.1.1. Read
`council-mcp-edge-osv.log` in the archive. Do not call security green because the
SBOM generator passed. Do not upgrade packages without the applicable approval.

## Exact tested state and publication boundary

Before this handoff, PR #311 pointed at `e5073e070d1c899a0c269ecd79f6e1a6dfbbe9a0`
on `feat/modular-agon-full`. The local implementation branch
`fix/modular-qualification-continuation` was 160 commits ahead at
`8f395e480495bf39168692fdb63ea4a61f73f1aa`, plus the Council working-tree changes.
Raphael then explicitly requested pushing all of it, not only this document.
The publication commit is a WIP snapshot of those changes. It does not turn
working-tree receipts into clean-checkout release receipts.

Latest full gate: `council-cutover-requalification`, 835.786 seconds, exit 0.
Includes build, catalog check, release-set/SBOM generation, full tests, types,
lint, re-export guard and diff check. Log SHA-256:
`28e518f3042fcbb6b86929eda5b4dfe3f2231bc6079ec725bb7dfdac814de8f5`.

Latest native gate: `council-cutover-native-final`, 35.655 seconds, exit 0.
Includes 18 fresh processes and catalog/release/SBOM drift checks. Log SHA-256:
`eed6b14469c6b1cf4505559d0d3a48b6c73b003f438aefb258f34f8aca4b613c`.
Both used isolated state and recorded zero external provider launches.
The native checks use compiled workspace code, not a freshly installed candidate.
Nested MCP-host checks are not full JSON-RPC transport tests.

## Logs and evidence for an AI reader

[Evidence index](docs/specs/evidence/nico-handoff-2026-10-24/index.json)
lists original paths, original hashes, exported hashes and redaction counts.
[Compressed evidence](docs/specs/evidence/nico-handoff-2026-10-24/development-evidence.tar.gz)
contains top-level development logs, receipts, review packets, notes and helpers.
Nested worktrees, installed dependencies, caches and personal authentication
files are not evidence and are excluded. Original local evidence is retained.

Extract into a disposable directory and read, do not execute archived helpers
blindly. Some helpers contain machine-specific paths. Sanitized bytes can differ
from original receipt hashes; use the export index to verify the archive copy.
Historical failing logs and rejected review findings are intentionally retained.
Start with `durable-config-integration-scope.md`, then the current Council logs,
`council-runtime-owner-codex-review.log`, and
`synthesis-entry-winner-reproduction.receipt.json`. Its PASS means the bug was
reproduced, not that Synthesis is correct.

## Working together

Nico can branch from this PR branch and work on it. Do not install it over a
working global Agon just to review it. Use isolated homes/caches/prefixes and
provider blockers. Do not run a paid panel or live credentials by accident.

Codex currently owns Council review fixes and the next Synthesis migration.
Useful independent work: review the ownership/kill-list evidence, qualify a clean
candidate on Nico's native platform, or audit installed-product behavior. Pick
non-overlapping files before implementing. Do not force-push the shared branch.

Suggested AI starting prompt: Read MODULAR-AGON-HANDOFF.md and its linked audit,
roadmap and evidence. Verify the current branch and source before believing any
status. Tell me which work is implemented, which is unverified, which is broken,
and which needs external evidence. Work in a separate branch; preserve existing
behavior and do not modify global Agon or personal state.
