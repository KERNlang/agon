# Modular Agon migration and verification

**Status:** FROZEN IMPLEMENTATION/VERIFICATION PLAN
**Date:** 2026-08-20

---

## Migration thesis

The dangerous failure is a half-modular mode: removed from one menu but still
reachable through an alias, MCP, Cesar, a persisted plan, or a static guide.
Migration therefore proceeds by complete vertical slices behind compatibility
adapters. Physical package extraction comes after behavioral ownership is proven.

The ordered slices and gates are normative. Executable contract evidence is
indexed in
[`modular-agon-contracts-and-evidence.md`](./modular-agon-contracts-and-evidence.md).

## Baseline to preserve

**VERIFIED 2026-08-20 qualification:**

- 43 top-level help surfaces passed.
- 365 test files passed: 5,432 tests passed and 3 skipped.
- build, TypeScript, ESLint, re-export, generated docs, audit, and package gates
  passed.
- Doctor reported 19 configured engines OK, 3 optional warnings, 0 failures while
  distinguishing configured API credentials from live reachability.
- live runs covered ask, all Think strategies, Nero, Council, Synthesis,
  Brainstorm/Campfire variants, all Tribunal modes, team modes, Forge, Team Forge,
  Review, mutation, Naturalize, Research, browser host, daemon, rooms, TUI, and
  representative CLI/API/local engines.
- external blocks were classified separately: OpenRouter/Aider 401, Tailscale
  daemon down, optional Mistral/Qwen absent, and a final Brave page action needing
  the operator to open the side panel.

The repeatable baseline is documented in
`docs/upgrade-pressure-test.md`. Modularization extends that runbook; it does not
replace it.

## Slice plan

### Slice 0 — freeze contracts and fixtures

**Specification evidence complete.** Regeneration and source-drift checks remain
mandatory during implementation.

- Preserve the existing pressure-test runbook and final receipts.
- Snapshot all current CLI commands/aliases, TUI slash entries, MCP tools, Cesar
  action/plan-step types, docs headings, result types, events, config keys, and
  package files.
- Convert representative historical receipts to sanitized test fixtures.
- Add a surface-parity report that shows the owner/source of every entry.
- Add minimal/full profile fixtures before behavior changes.

Exit: the current interface can be compared mechanically to a future registry.

### Slice 1 — Mod API and hardened discovery, behavior-neutral

#### Slice 1A — non-durable contracts and projections (safe to start)

**Implemented in the isolated non-shipping Slice 1A worktree.** The concrete
package, registry, parity, boundary, and performance receipt is
[`modular-agon-slice1a-implementation.md`](./modular-agon-slice1a-implementation.md).
Legacy dispatch remains authoritative.

- Introduce strict manifest v2 types/schema, `ModRegistry`, resolver, lock model,
  typed blocked reasons, and owner-tagged registrations.
- Build resolver and canonical lock behavior as in-memory/test fixtures only.
- Harden parse/discovery checks that do not persist grants or import new
  third-party executable code: containment, collisions, no implicit repo code,
  manifest/integrity hooks.
- Hoist mod bootstrap so one-shot CLI, interactive TUI, MCP, daemon, and browser
  hosts can project the same fixture graph behind compatibility adapters.
- Keep all existing static commands active through a `legacy-builtin` adapter.

Exit: no public behavior changes; security posture improves immediately.

Slice 1A may ship only as behavior-neutral compatibility plumbing. It creates no
durable managed store, stable third-party ABI promise, grant/trust persistence,
or executable external activation path.

#### Slice 1B — durable host

- Implement the frozen deterministic resolver/source precedence and canonical
  lock bytes.
- Implement immutable generations, writer lock/journal, safe mode, grants/trust,
  package-closure verification, and process generation handshakes.
- Qualify crash recovery, downgrade, global/npx/link/offline, and the declared
  platform matrix before enabling executable third-party discovery.

Exit: the full-profile surface snapshot is byte/structure compatible and every
readiness blocker required for Think ownership is closed.

Slice 1B is qualified separately from the first mode extraction. Slice 3 cannot
start until its exit gate passes.

### Slice 2 — one canonical surface catalog

- Adapt existing top-level commands, slash metadata, MCP tools, guides, result
  formatters, and lifecycle events into owner-tagged registry entries.
- Consumers read projections from the registry while legacy arrays/switches remain
  byte-compared compatibility sources.
- Add collision and disabled-trigger tests.

Exit: registry projections equal all legacy catalogs for the full profile.

This remains behavior-neutral: the registry and legacy sources are compared and
the legacy execution path remains available for rollback. No mode is disabled or
removed in the compatibility profile yet.

### Slice 3 — `think` vertical mod

- Move Think manifest, command schema, TUI intent, handler, Forge implementation,
  MCP/Cesar exposure if applicable, result formatter, docs, config, events, and
  tests behind one mod registration.
- Delete Think-specific entries from legacy catalogs after parity passes.
- Verify all strategies: linear, reflexion, tree, graph, hypothesis; branches;
  critic; artifacts; timeout/cancel; exact disable behavior.
- Create a dependent fixture workflow to prove enable/downstream and disable/
  reverse-cascade semantics without coupling the production Pipeline to Think.

Exit: no kernel file contains a Think trigger; disabling Think removes every
surface and enabling it restores all surfaces.

This is the first intentionally user-visible modular release and has its own
compatibility/rollback gate. It is not folded into the behavior-neutral Slice 1/2
release claim.

### Slice 4 — plan/execution and dependency exemplar

- Migrate plan/approve/retry/cancel, build/agent primitives, and preview ownership.
- Migrate Pipeline with hard dependencies on Brainstorm, Forge, and Tribunal.
- Persisted plans with unavailable step types pause with typed recovery guidance.
- Active jobs veto or defer deactivation.

Exit: dependency closure and reverse-cascade behavior pass in real workflows.

### Slice 5 — orchestration families

Migrate complete families, one PR/slice at a time:

1. Brainstorm and Team Brainstorm.
2. Tribunal and Team Tribunal.
3. Campfire.
4. Forge, Team Forge, fitness, gauntlet.
5. Synthesis.
6. Council and Nero.
7. Review and mutation integration.
8. Research/RAG and browser capabilities.
9. Sanitize/Naturalize.
10. Goal and Conquer.
11. Rooms as `agon-mod-rooms`, daemon/jobs as `agon-mod-jobs`, and serve/native
    browser surfaces as `agon-mod-browser`; low-level process/socket machinery
    remains hidden kernel/support code.

Each family exits only after all static triggers are removed and the full profile
remains compatible.

### Slice 6 — configuration and wizard

- Add user-global activation and profile management. Repository configuration may
  tune an already-active mod but cannot request, enable, disable, install, or grant
  one.
- Add CLI/TUI mod list/info/enable/disable/verify/doctor/rollback.
- Keep disabled mods visible/greyed and group/nest them by manifest family and
  hard-dependency relationship. Hide support-only modules outside advanced view.
- Implement transaction preview and safe-point handling.
- Migrate current users to `full-compat`; preserve unknown/personal state.
- Wizard consumes registry metadata and never maintains a separate mod list.
- Regenerate Codex/AGENTS routing from the active graph without overwriting
  handwritten user instructions.
- Add desired-state export/import without secrets or trust grants.

Exit: minimal, custom, and full profiles install/activate deterministically.

### Slice 7 — package extraction and npx setup

- Freeze Mod API v1.
- Extract first-party workspace packages without changing manifests/IDs.
- Produce one physical package per user-toggleable mod; release all first-party
  packages in lockstep for v1.
- Publish package provenance and integrity.
- Implement managed installation prefix, lifecycle-script denial, staging, lock,
  verification, and rollback.
- Test npm global, npx ephemeral setup, linked source checkout, offline reinstall,
  upgrade, downgrade, and corrupt package refusal.

Exit: users can select actual package installation, not only activation.
The modular release cannot exit this slice while first-party user-facing modes
remain only chunks inside the kernel/CLI package.

### Slice 8 — remove compatibility layer

- Remove legacy catalogs/switches only after every contribution has an owner.
- Add a kernel-purity guard rejecting mode-name triggers in kernel packages.
- Retain manifest/config migration for at least one documented compatibility
  window.

Exit: adding a first-party mode requires a mod package and no kernel catalog edit.

## Verification architecture

### Test layers

1. **Schema tests:** malformed manifests, limits, semver, unknown fields, unsafe
   paths, prototype keys.
2. **Resolver property tests:** arbitrary DAGs, cycles, conflicts, optional edges,
   reverse closure, deterministic ordering, stable lock hashes.
3. **Transaction tests:** concurrent writers, crash at every phase, rollback,
   interrupted downloads, migration failures, stale locks.
4. **Registry invariant tests:** ownership, collisions, aliases, disposal,
   generation consistency.
5. **Per-mod contract tests:** every declared surface registers and unregisters;
   config validates; declared artifacts/events/results conform.
6. **Disabled tests:** every trigger path rejects or disappears when the mod is
   disabled.
7. **Dependency tests:** required closure, optional integration, cascade, no-
   cascade refusal, active-job veto.
8. **Profile tests:** minimal, full-compat, custom, missing dependency, conflict,
   corrupt lock, private override.
9. **Package tests:** tarball contents, integrity, no caches/build debris, no
   install scripts, clean install.
10. **Pressure tests:** existing complete suite plus bounded live canaries.

### Required per-mod contract

Every first-party mod ships machine-readable verification metadata and must pass:

- manifest/schema/compatibility;
- package/import smoke;
- activation and deactivation cleanup;
- CLI help and invocation;
- TUI discovery/parse/dispatch;
- MCP discovery/call or explicit absence;
- Cesar discovery/proposal/dispatch or explicit absence;
- docs/help generation;
- result/event/artifact schema;
- config defaults/migration/retention;
- dependency and reverse-dependency behavior;
- cancellation/timeout/failure receipt;
- disabled trigger sweep;
- representative unit/integration scenario;
- optional live engine canary where the mod dispatches models.

The runner fails if a manifest contribution lacks a corresponding test receipt.

### Disabled trigger sweep

For a disabled mod, assert all relevant paths:

- `agon <command>` returns typed unavailable/unknown behavior as specified;
- aliases cannot invoke it;
- `/command` is absent or visibly disabled in TUI help/completion;
- direct slash parsing cannot synthesize its intent;
- natural language cannot make Cesar choose it;
- MCP `tools/list` omits it;
- MCP emits `tools/list_changed` where supported;
- a stale MCP call receives `MOD_UNAVAILABLE`;
- a cached Citty/lazy handler reference cannot execute past the kernel generation
  guard;
- plan step creation rejects it;
- persisted plans pause rather than fall through;
- generated agent guide/docs do not advertise it as active;
- event subscriptions and background timers are disposed;
- result formatters for historical receipts still work without activating code,
  through a safe data-reader/compatibility path;
- no package entrypoint is imported at cold boot.

### Profiles under test

| Fixture | Purpose |
|---|---|
| `minimal` | Kernel boots with no orchestration families. |
| `full-compat` | Exact current command/surface parity. |
| `think-only` | First vertical mod and no accidental dependents. |
| `pipeline-orchestration` | Required brainstorm/forge/tribunal dependency closure. |
| `pipeline-orchestration-minus-tribunal` | Blocked-state reason and recovery. |
| `pipeline-delivery` | Independent agent/review dependency closure and compatibility alias. |
| `cascade-disable` | Reverse dependency transaction. |
| `conflict` | Atomic refusal and explanation. |
| `cycle` | Complete cycle path. |
| `repo-cannot-activate` | Repo activation/install/trust requests are ignored/rejected; no import on open. |
| `private-settings-only` | Personal project settings apply only to already-enabled mods and never alter activation. |
| `rollback` | Prior generation restored after activation failure. |

## Repeatable commands

**PROPOSED scripts/commands:**

```bash
npm run test:mods
npm run test:mods -- --profile minimal
npm run test:mods -- --profile full-compat
npm run test:mod -- think
npm run pressure:upgrade -- --offline
npm run pressure:upgrade -- --live

agon mod verify --all
agon mod doctor --all
agon mod graph
agon mod graph --why pipeline-orchestration
agon mod plan disable think
```

Offline qualification is deterministic and mandatory. Live tests are bounded,
cost/network-aware, preserve receipts, and classify auth/network/operator gates
separately.

## Historical replay

Historical run directories are evidence, not executable golden answers. Sanitized
fixtures retain:

- mode/result schema version;
- graph/version provenance;
- status transitions;
- artifacts and formatter inputs;
- timeout/failure classifications;
- no prompts, secrets, or provider reasoning unless explicitly safe.

Replay proves that historical results remain readable when the producing mod is
disabled or no longer installed. It does not demand stochastic model text match.

## Compatibility policy

- Existing command names and aliases remain valid in `full-compat` for at least one
  major compatibility window.
- Existing installs migrate with all current features selected.
- A disabled command is not silently rerouted.
- Existing config values move to mod namespaces through idempotent migrations;
  backups and unknown values are retained.
- Persisted plan/job/result/session records use the frozen common envelopes with
  owner mod ID/version, session/trace IDs, payload version, receipt IDs, status,
  and byte-preserved payload. Missing producers pause executable state; they do
  not mutate or discard payloads.
- Every run keeps a generic structured payload and rendered snapshot so history is
  readable after a mod is disabled, uninstalled, or downgraded.
- History, ratings, receipts, run artifacts, rooms, worktrees, auth, and private
  engines retain their current paths unless a separately specified migration is
  required.
- Extension manifest v1 receives a compatibility reader with warnings, no unsafe
  override semantics, and a documented removal window.
- Old clients receive stable unavailable errors from new kernels.
- Newer manifest/API versions fail closed on older kernels with an upgrade hint.
- Each migration release declares the oldest supported downgrade target, retains
  the required state backup/compatibility adapter, and executes a real downgrade
  fixture before release.

## Release gates per slice

Every slice must pass:

```bash
npm run build
npm run typecheck
npm test
npm run lint
npm run guard:reexports
npm run docs:modes
npm audit
npm pack -w packages/cli --dry-run
```

plus:

- mod schema/resolver/transaction suites;
- minimal and full-profile parity;
- affected mod contract tests;
- disabled trigger sweep;
- package/lock reproducibility;
- affected live canaries;
- `docs/upgrade-pressure-test.md` qualification dimensions.

The suite must run with real local loopback permissions where daemon/serve tests
require sockets; sandbox `EPERM` is recorded as an environment limitation, not
misdiagnosed as a product regression.

### Candidate qualification and promotion

The installed production Agon is never the development test target. Modular
cutover follows this fixed sequence:

1. Capture the currently installed release's surface, performance, package, and
   representative workflow/pressure receipts.
2. Build every kernel/API/support/mod package in the development checkout and run
   source-level gates.
3. Pack the exact release tarballs; from this point, workspace imports are not
   evidence.
4. Install only those tarballs into a temporary isolated prefix with a temporary
   `AGON_HOME`, lifecycle scripts disabled, and no access to personal config or
   credentials unless a bounded live canary explicitly supplies references.
5. Run clean-install, full-compat parity, minimal/custom profiles, every per-mod
   contract, disabled/dependency sweeps, offline pressure tests, performance
   comparison, and safe-mode/rollback failure injection.
6. Copy a sanitized production-state fixture into another isolated home and prove
   real upgrade, downgrade, and byte-preserving failed migration.
7. Run bounded live canaries for every engine-dispatching workflow, including the
   historical Agon upgrade pressure dimensions. Classify auth/network/provider
   failures separately from product regressions.
8. Promote only the verified immutable release generation. Never overwrite a
   linked development installation or the previous production generation.
9. Repeat Doctor, package/graph verification, surface parity, performance smoke,
   and representative live workflows against the promoted installation.
10. Keep the prior generation immediately selectable until the rollback window
    closes. Any post-promotion regression flips back and preserves both failure
    and rollback receipts.

The promotion receipt binds source commit, release BOM, tarball integrity, graph
hash, test/pressure receipts, platform, and promoted/previous generations.

### Slice 1A non-shipping qualification

The implemented foundation is qualified by
[`evidence/modular-agon-slice1a-verification-receipt.json`](./evidence/modular-agon-slice1a-verification-receipt.json),
with independent-review dispositions in
[`evidence/modular-agon-slice1a-review-adjudication.md`](./evidence/modular-agon-slice1a-review-adjudication.md)
and current budgets in
[`evidence/modular-agon-slice1a-performance.json`](./evidence/modular-agon-slice1a-performance.json).
This receipt proves the source-only compatibility boundary; it is not an install,
promotion, trust, activation, or physical-extraction receipt.

## Blast radius

The exhaustive lifecycle/artifact matrix, blocking clauses, and failure-injection
suite live in
[`modular-agon-blast-radius-and-readiness.md`](./modular-agon-blast-radius-and-readiness.md).
The package/author boundary and exact static-versus-built file contract live in
[`modular-agon-authoring-build-and-packaging.md`](./modular-agon-authoring-build-and-packaging.md).
This section is only the quick navigation list.

High-blast-radius areas include:

- CLI boot before Citty command construction;
- TUI startup and asynchronous extension initialization;
- intent parsing and Cesar route selection;
- MCP tool discovery and stale clients;
- persisted plans/jobs/results referencing type IDs;
- config merge/migration and concurrent writes;
- package release/link/update behavior;
- extension trust and repository open behavior;
- generated docs/skills/agent guides;
- tree-shaking/lazy chunk boundaries and startup latency.

Adapters and engine JSON are intentionally not rewritten in the same migration.
They become kernel capabilities consumed by mods.

## Exit criteria for the rewrite

- [ ] All first-party feature modes have a manifest owner.
- [ ] Kernel catalogs contain no feature-specific triggers.
- [ ] Full profile matches current behavior and historical result readability.
- [ ] Minimal/custom installs contain and activate only their resolved graph.
- [ ] All dependency, security, transaction, and disabled-trigger tests pass.
- [ ] Every mod passes its declared contract and pressure test.
- [ ] Installer, upgrade, rollback, linked checkout, and offline behavior pass.
- [ ] Personal/private state is preserved and excluded from first-party commits.
- [ ] Documentation is generated from registry data and matches runtime discovery.
- [ ] Remaining product decisions are resolved or explicitly deferred without
      weakening safety claims.
