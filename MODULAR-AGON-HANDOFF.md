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

Current checkpoint: **development-base merge readiness**, not release approval.
Upstream `main` at `dc6853e61404d7db710c1f6fd6499c46ba85dc15` is integrated:
judged ratings, model identity, decay and ratings reset now use the physical
module owners. All merge conflicts are resolved. The full integration gate passes:
build, types, lint, re-export guard, release-set, supply-chain and repository tests.
Clean committed-checkout pressure qualification passed all 11 gates on
`02601ad645cb3fb08d7c5720b7800517e379f8d0`: 3,523 shuffled modular tests and
186 freshly executed workflow tests, with zero provider launches. However,
GitHub CI found a cold type-check build-order defect that this older harness
missed because it built first. The defect is reproduced and a project-reference
fix passes the full local gate; the harness now checks types before building.
The repaired commit still needs clean-checkout pressure and GitHub CI results.
Nico should wait for the explicit merge-ready result. Full release work continues
afterward on a new branch; its acceptance criteria are unchanged.

Latest integration evidence:

- Cold-typecheck repair: full build, types, guards, release-set, supply-chain,
  lint and 11,625 tests pass (six skipped), with zero provider launches.
  Receipt `dev-base-cold-qualified-full.receipt.json`, log SHA-256
  `285d81fd5b03d82ff14fc763b70bafa6ceb8463fc207ab3877885aeba2fbe7b4`.
  [Cold-build evidence](docs/specs/evidence/nico-handoff-cold-build-2026-10-24/index.json)
  retains the failing controls, passing checks and independent Codex review.
- Full run: 11,625 tests passed, 6 skipped; 691 files passed, 1 skipped.
  Receipt `upstream-dev-base-full-reconciled.receipt.json`, log SHA-256
  `22048bd8ecdaff8e333256cf2cd036e7c1f730d0ac5887833fac65578385e796`.
- Council: 21 compiled CLI/MCP-host/session process checks passed. Ratings reset:
  five real CLI processes passed, including preview/refusal, apply and byte-exact
  backup restoration. All used isolated fixtures; zero real provider launches.
- Independent Codex reviews found missing Plan workspace capture, judging-effect
  lifetime and ballot authority defects. Reproduced defects have regression
  coverage and local fixes. Abort-ignoring third-party code cannot be forcibly
  stopped in-process; timeout cleanup is bounded and late API writes are blocked.
- [Integration evidence index](docs/specs/evidence/nico-handoff-upstream-2026-10-24/index.json)
  links original and sanitized hashes. Its archive includes earlier failed runs
  and historical notes, not only passing receipts. Read the latest receipts and
  this handoff before interpreting older status statements.
- [Ratings CLI reproduction helper](docs/specs/evidence/nico-handoff-ratings-reset-2026-10-24/index.json)
  is retained separately. Original evidence remains outside Git in
  `/Users/ra/dev/modular-agon-remediation`; no original archive was deleted.

## What the numbers mean

| Measure | Verified status at this handoff |
|---|---|
| Physical target packages | 49 exist and are represented in the release-set check |
| Package-map dependency edges | 158 unique edges in the checked structural map |
| Frozen legacy ownership assignments | 872 assignments to reconcile; NOT 872 proven retired owners |
| Latest full local test run | 11,625 passed, 6 skipped; 691 files passed, 1 skipped |
| Latest Synthesis native probes | 9 passed: CLI, MCP-host and session/fallback boundaries |
| Latest Council native probes | 21 passed: 8 session, 7 CLI, 6 nested MCP-host processes |
| Fresh release acceptance on this exact snapshot | Not established; do not mark any of the nine final slice receipts accepted from these working-tree results |
| Remaining closure groups below | 6; these are work groups, NOT six bugs or a completion percentage |

There is no reliable total count of unfinished individual defects. The reproduced
Synthesis winner defect and four independent review findings are repaired;
three Council review findings are also repaired. Full-suite and native development
checks pass for these increments. Do not translate
package counts or test counts into percent done.

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
| 1. Council review | Closed for this increment: three confirmed findings repaired, full suite and native probes pass | Review adjudication and hashes in the product audit; final release qualification remains group 4 |
| 2. Synthesis ownership/parity | Parser and cancellation repaired; runtime/session ownership and swap/output parity remain | Frozen oracle, discriminating parser tests, native command/session tests |
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

**Synthesis repairs:** physical and legacy execution now share the mod-owned
winner/score parser. Entry labels and markdown select the correct engine.
Cancellation reaches discovery, draft/swap/judge calls and session jobs; no late
session results are published. Disabled fallback Synthesis cannot start a job.
Four independent review findings and the fallback defect have negative controls.
Runtime/session ownership, swap pairing and output parity remain open; these
repairs do not establish complete extraction. See the product audit for receipts.

**Council independent review, confirmed and repaired:**

1. Session rejects one advisor plus an external chairman before forming the effective roster.
2. Failed advisors can leave a successful verdict labelled `degraded: false`.
3. Non-CLI output gives quiet precedence over JSON, unlike CLI presentation.

Each finding has failing-before/passing-after tests. The advisor degradation bug
was inherited from the legacy runtime; the frozen oracle remains unchanged and
the parity test explicitly checks this corrected difference. Effective session
rosters now include an available external chairman before minimum-size validation,
and JSON wins over quiet consistently. The isolated Agon/Codex review packet and
response remain in the evidence export. Later regression receipts are detailed
in the product audit. Full-suite and native development checks pass for these fixes.

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

Pre-publication full gate: `council-cutover-requalification`, 835.786 seconds, exit 0.
Includes build, catalog check, release-set/SBOM generation, full tests, types,
lint, re-export guard and diff check. Log SHA-256:
`28e518f3042fcbb6b86929eda5b4dfe3f2231bc6079ec725bb7dfdac814de8f5`.

Pre-publication native gate: `council-cutover-native-final`, 35.655 seconds, exit 0.
Includes 18 fresh processes and catalog/release/SBOM drift checks. Log SHA-256:
`eed6b14469c6b1cf4505559d0d3a48b6c73b003f438aefb258f34f8aca4b613c`.
Both used isolated state and recorded zero external provider launches.
The native checks use compiled workspace code, not a freshly installed candidate.
Nested MCP-host checks are not full JSON-RPC transport tests.

Post-review gate: `council-reviewed-full-qualification`, 669.669 seconds, exit 0.
Release-set/SBOM refreshed; 11,414 tests passed, 6 skipped; 21 native probes
passed after the suite. Log SHA-256:
`3f079c05b7983bf9b99fb795dd9ef7ddcfc37dc71595c5c96b18c09012771b6e`.
Build/types/lint/export checks passed in `council-review-fixes-build-native`.
No external provider launched. These remain working-tree development checks,
not clean installed-release acceptance.

## Logs and evidence for an AI reader

Latest Synthesis gate: `synthesis-reviewed-full-gate-v3`, exit 0, 981.961 seconds.
Build, catalog/release/SBOM checks, full tests, types, lint, re-export guard,
diff check and nine native processes passed. Zero external provider launches.
Log SHA-256: `f4264aecc93425801ee194a19d2fdf90ac56a4f6195462884388bf23352695f1`.
These are working-tree development checks, not clean installed-release receipts.

[Synthesis evidence index](docs/specs/evidence/nico-handoff-synthesis-2026-10-24/index.json)
and [52-file evidence supplement](docs/specs/evidence/nico-handoff-synthesis-2026-10-24/development-evidence.tar.gz)
retain failures, review, fixes and final gate. Archive SHA-256:
`5f8065150b34e68477ebfc5502f3375268fb40d156ff14fadf6c7fda959dce6f`.
Every archived member passed retrieval/hash verification. Original logs and the
older archive below remain unchanged.

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

Codex currently owns upstream-main integration and development-base qualification.
Useful independent work: review the ownership/kill-list evidence, qualify a clean
candidate on Nico's native platform, or audit installed-product behavior. Pick
non-overlapping files before implementing. Do not force-push the shared branch.

Suggested AI starting prompt: Read MODULAR-AGON-HANDOFF.md and its linked audit,
roadmap and evidence. Verify the current branch and source before believing any
status. Tell me which work is implemented, which is unverified, which is broken,
and which needs external evidence. Work in a separate branch; preserve existing
behavior and do not modify global Agon or personal state.
