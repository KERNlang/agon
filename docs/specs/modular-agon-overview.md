# Modular Agon: kernel, mods, and profiles

**Status:** IMPLEMENTATION-READY V1 SPECIFICATION
**Date:** 2026-08-20
**Branch:** `spec/modular-agon`

---

## Executive summary

Agon currently exposes a growing collection of modes through several parallel,
mostly static catalogs. The product goal is to turn those modes into selectable
mods around a small kernel. A user must be able to choose a profile or individual
mods during npm/npx setup, inspect and change activation from the CLI or TUI, and
obtain the same behavior from CLI, TUI, MCP, Cesar, help, docs, and receipts.

The recommended architecture is a **capability-gated mod registry**:

1. Installed mod packages expose a declarative manifest without executing code.
2. The kernel validates manifests, compatibility, trust, permissions, conflicts,
   and a directed acyclic dependency graph.
3. A lockfile records the exact resolved graph and package integrity.
4. Only active mods are imported. Each registers all of its surfaces through one
   versioned Mod API registrar/services contract.
5. CLI, TUI, MCP, Cesar, docs, result formatting, and lifecycle subscriptions are
   projections of the same registry rather than separate handwritten catalogs.

This is a staged rewrite, not a big-bang file move. The first implementation
slice hardens the existing extension substrate and introduces the registry with
no user-visible behavior change. `think` is then the first complete vertical mod
because it is small enough to migrate safely and is the dependency example the
new resolver must prove.

## Confidence and evidence

**Recommendation confidence: high (94%).** The target behavior, current static
wiring, ownership map, contracts, and macOS baselines are directly evidenced.
Linux execution receipts and final profile naming remain external/product gates.

Claim labels in these specs mean:

- **VERIFIED:** confirmed in the current TypeScript source, tests, commands, or
  historical run artifacts.
- **PROPOSED:** normative design for the rewrite.
- **DEFERRED:** requires an operator/product decision, an unavailable external
  system, or a future implementation spike; it is not locally resolvable here.

## Current state

### Verified architecture

- **VERIFIED:** top-level Citty commands are assembled in
  `packages/cli/src/lazy-commands.ts` before `runMain()`.
- **VERIFIED:** TUI slash help and parsing are separately hard-coded in
  `packages/cli/src/signals/intent.ts` and
  `packages/core/src/blocks/builtin-commands.ts`.
- **VERIFIED:** orchestration dispatch statically imports handlers and switches on
  intent types in `packages/cli/src/signals/dispatch/*`.
- **VERIFIED:** most orchestration implementations are exported from
  `packages/forge/src/index.ts`; CLI handlers add UI/session behavior around them.
- **VERIFIED:** MCP exposes another static orchestration catalog in
  `packages/mcp/src/agon-orchestration.ts`.
- **VERIFIED:** agent guides and generated mode docs contain another manually
  maintained mode catalog in `packages/cli/src/commands/agent-guide-text.ts`.
- **VERIFIED:** lifecycle result subscriptions currently name fixed mode events in
  `packages/cli/src/surfaces/app-lifecycle.ts`.
- **VERIFIED:** the existing extension loader supports commands, engines, skills,
  hooks, and prompt fragments, but is initialized only by the interactive app.
- **VERIFIED:** the current extension manifest declares permissions but the loader
  does not enforce them; handler paths lack a realpath containment check; duplicate
  IDs use last-wins replacement; command registration silently overwrites names.
- **VERIFIED:** configuration merges global `~/.agon/config.json`, repo
  `.agon.json`, and gitignored `.agon.local.json`, with the private file strongest.
- **VERIFIED:** the 2026-08-20 qualification corpus includes 105 local run
  directories: ask 48, think 10, review/tribunal 8 each, research 6, forge 4,
  brainstorm/campfire/team-brainstorm 3 each, council/nero/synthesis/team-tribunal
  2 each, and mutate/naturalize/team-forge 1 each.

### Root problem

Adding or disabling a mode is currently a cross-cutting source edit. A mode can
remain callable through MCP, Cesar, an alias, a plan step, or a generated guide
even if its visible CLI/TUI entry is removed. That makes activation incomplete,
testing difficult, and the growing interface noisy.

The rewrite must establish one answer to each of these questions:

- What is installed?
- What is selected?
- What is currently active?
- Which dependency or permission blocks a selected mod?
- Which surfaces does the mod own?
- What exact versions and grants produced a run?

## Product language

These terms are distinct and must remain distinct in UI, config, and code:

| Term | Meaning |
|---|---|
| Kernel | Always-present boot, state, permissions, registries, dispatch primitives, and mod lifecycle. |
| Mod | A versioned feature package with a validated manifest and optional executable entrypoint. |
| Installed | Package bytes and a verified manifest exist in the managed mod store. |
| Selected | Config expresses user intent to enable the mod. |
| Available | Compatible, trusted, granted, conflict-free, and all hard dependencies resolve. |
| Active | Imported and registered in the current process. |
| Blocked | Selected, but unavailable for an explicit recorded reason. |
| Disabled | Explicitly not selected. Its data is retained. |
| Profile | A named desired set of mods and defaults, not a separate runtime. |

## Operator decisions frozen on 2026-08-22

These are product decisions from the specification dialogue, not remaining
implementation options:

- **Everything user-facing becomes a mod.** `ask`, Think, Brainstorm, Tribunal,
  Forge, Review, Research, Rooms, browser workflows, Goal, Council, Nero,
  Synthesis, RAG, and every other feature/mode are independently owned and
  disableable. Modularization is an architectural rewrite, not a wrapper around
  the current static catalogs.
- **The kernel is machinery only:** boot, config/trust, resolver/mod manager,
  engine/provider communication primitives, dispatch/stream/cancel, receipts,
  diagnostics, updater/rollback, generic TUI shell, and safe-mode recovery.
- **Current useful workflows remain installed and enabled by default.** In
  particular Ask, Think, Brainstorm, Tribunal, Review, and Forge are first-party
  mods, not non-disableable kernel features. Existing installations migrate to
  full compatibility without losing behavior or state.
- **Every user-toggleable first-party mod becomes its own physical package before
  the modular release is complete.** Implementation may stage registry work first,
  but the release gate includes real packed packages and clean-room installation.
  First-party packages version and release in lockstep initially.
- **Shared infrastructure is not duplicated.** Engine/provider communication is
  kernel capability; reusable panel/judge/worktree/rating support may be internal
  support packages. Support modules are hidden from the normal mod list and shown
  only in an advanced dependency view.
- **Dependencies form grouped UI.** Brainstorm may work alone; Team Brainstorm
  depends on Brainstorm. Forge may work alone; Team Forge depends on Forge. The
  UI nests dependents under their family, previews automatic dependency enables
  and reverse-disable cascades, and never pretends sibling workflows require one
  another merely because they share infrastructure.
- **Mod selection is user-global and Agon-owned in v1.** Repositories cannot
  install, request, enable, or disable mods. Project config may configure an
  already-enabled workflow but cannot change activation, trust, or permissions.
- **Both CLI/Codex and TUI management are required.** They call the same resolver
  and transaction service. Disabled mods remain visible but greyed out and are
  grouped by manifest category/family. Local/community mods show source and trust
  badges.
- **Profiles stay simple.** A profile is only a named selection/defaults document;
  applying it expands into ordinary desired mod state. It is not a separate
  runtime or architecture.
- **macOS and Linux are the supported v1 platforms.** Windows is explicitly
  deferred while paths, locks, and package contracts remain portable.
- **Long-running processes may require restart.** New short-lived Codex/CLI calls
  see committed changes immediately. TUI, MCP, daemon, room watcher, and browser
  hosts pin their generation and drain/restart rather than hot-replacing ESM.
- **No manual Nexus-style load ordering in v1.** Required dependencies determine
  order; unrelated mods use deterministic ID order. Optional ordering metadata is
  reserved for a proven hook interaction. Collisions and ambiguous overrides fail
  visibly; folder mods cannot silently replace first-party contributions.
- **Folder mods are a polished extension of the same system.** Global discovery is
  under `$AGON_HOME/mods`; projects are not auto-scanned. Release mods bind trust
  to changed code, while an explicit development source may trust one selected
  path until revoked and remains visibly labeled development/full-trust.
- **Updates differ by ownership.** First-party mods update with the lockstep Agon
  release; new permission requests remain visible. Custom/community mod updates
  require an explicit version/dependency/permission/trust preview and approval.
- **Install UX has two paths:** `npm install -g @kernlang/agon` installs the
  current recommended complete set; `npx @kernlang/agon setup --with ...` builds a
  custom set. A future default may be leaner for new installs, but never silently
  rewrites an existing user's selections.
- **Selections are portable.** Export/import uses a small JSON desired-state file
  without credentials or trust grants.
- **Codex-facing routing follows activation.** Generated AGENTS/guide content is
  regenerated from the active registry after a mod change while preserving
  handwritten user instructions.
- **Nothing is deleted by disable/uninstall.** Config, history, ratings, receipts,
  plans, results, and unknown mod state remain until a separate previewed purge.
- **Usability and performance are release gates.** Enabled does not imply eager
  executable import. Every migrated workflow must match current behavior, pass
  Codex-over-Agon pressure tests, remain lazy where possible, and stay within
  measured startup/latency/memory budgets.
- **Cutover never uses the active Agon as the development test subject.** Build
  and pack in isolation, install under an isolated prefix/home, run offline and
  live pressure gates plus upgrade/downgrade/rollback, promote only when green,
  rerun against the promoted installation, and retain immediate rollback.

## Kernel boundary

### Always-present kernel

**PROPOSED:** only machinery required to discover, validate, activate, observe,
and safely run mods belongs in the kernel:

- CLI boot and global flags;
- config loading, scoped overlays, atomic writes, and migrations;
- authentication metadata and secret indirection;
- engine registry and the adapter/dispatch interfaces;
- permission evaluation and approval transport;
- command, intent, MCP/tool, result, docs, event, and configuration registries;
- job lifecycle, cancellation, process supervision, and event logs;
- artifact/run receipts, history index, and diagnostics primitives;
- TUI shell, composer, generic help/settings/mod manager surfaces;
- streaming transport and speculative-preview contamination firewall;
- mod discovery, manifest validation, trust/grant checks, resolver, lockfile,
  lifecycle, rollback, and Doctor support;
- updater and compatibility checks.

The kernel must not contain feature names such as `tribunal`, `forge`, or
`think`, except in migrations and compatibility fixtures. A guard test will make
that boundary mechanical.

### Bundled first-party mods

**PROPOSED:** “core” in product language means shipped, supported, and commonly
enabled—not impossible to disable. In particular:

- `think` is a bundled default mod and may be disabled.
- plan/build diff preview belongs to the plan/execution mod family; the low-level
  streaming preview safety mechanism remains kernel machinery.
- chat/ask may use a temporary compatibility adapter during migration, but it is
  a separately packaged, disableable first-party mod at modular-release exit.

The readable family summary is below. Exact physical packages, dependency edges,
and per-surface ownership are frozen in the generated package/ownership ledgers.

| Candidate mod | Likely hard dependencies | Notes |
|---|---|---|
| `ask` | engine dispatch, run receipts | Default first-party workflow; disableable despite using kernel dispatch. |
| `think` | engine dispatch, run receipts | First vertical migration. |
| `brainstorm` | engine panel, ratings, run receipts | Base family mod; Team Brainstorm is a separate dependent child. |
| `team-brainstorm` | brainstorm, team/panel support | Cannot activate without Brainstorm; nested in the same UI family. |
| `tribunal` | engine panel, ratings, run receipts | Base family mod; owns protocols and debate modes. |
| `team-tribunal` | tribunal, team/panel support | Separate dependent child nested under Tribunal. |
| `campfire` | engine panel, run receipts | No winner/scoring contract. |
| `forge` | worktrees, engine agent dispatch, fitness, receipts | Base family mod. |
| `team-forge` | forge, team/panel support | Separate dependent child nested under Forge. |
| `synthesis` | engine panel, judge, receipts | No fitness command required. |
| `council` | ratings, engine panel, judge | Role/chair contract. |
| `nero` | ratings, critique dispatch | Used independently and by larger workflows. |
| `review` | diff/context, engine review dispatch, receipts | Mutation integration is optional. |
| `mutate` | disposable worktrees, test runner | Semantic panel is optional engine capability. |
| `research` | fetch policy, citations, engine dispatch | Network permission is explicit. |
| `rag` | docs corpus, sidecar resolver | May provide a capability consumed by research/Cesar. |
| `sanitize` | deterministic file analysis | `naturalize` depends on this plus engine dispatch. |
| `browser` | serve/native host/capability bridge | `chrome` and `drive` become surfaces of one family. |
| `plan` | jobs, approvals, state store | Provides plan/approve/retry/cancel and diff preview. |
| `pipeline-orchestration` | brainstorm, forge, tribunal | Owns MCP's current brainstorm→forge→tribunal meaning. |
| `pipeline-delivery` | agent, review | Owns TUI/Cesar's current build→review→fix meaning. |
| `goal` | jobs, forge, review, oracle/gates | Long-running; disable must respect active jobs. |
| `conquer` | jobs, builder dispatch, nero/consult capability | Consult dependencies may be optional or hard by policy. |
| `rooms` | event store, locks, jobs | Cross-session collaboration. |
| `ratings` | persistence | Leaderboard is its visible surface. |

The complete v1 map has 49 physical packages: 2 kernel/API, 11 hidden shared
support packages, and 36 toggleable mods. It additionally assigns Agent, Jobs,
History, Provenance, Flow, Worktrees, Skill Authoring, Git Actions, Routing Docs,
Memory, Naturalize, and Team child packages that the shorter family table omits.
See [`modular-agon-package-map.json`](./evidence/modular-agon-package-map.json) and
[`modular-agon-ownership.json`](./evidence/modular-agon-ownership.json).

## Recommended architecture

### Option A — canonical in-process mod host (recommended)

Manifests are resolved before code import. First-party and explicitly trusted
mods register through a narrow API. Every outward surface is generated from the
registry. The same ABI can later sit behind a process boundary.

Benefits:

- meets live CLI/TUI activation requirements;
- reuses the existing extension substrate;
- permits lazy loading and small startup cost;
- allows gradual migration with compatibility adapters;
- keeps subprocess isolation and generated catalogs available later.

Constraint: in-process capability APIs reduce accidental authority but are not an
OS security boundary. The trust model must say this plainly.

### Option B — subprocess-only mods

Every executable mod runs through versioned JSON-RPC and capability endpoints.
This provides real crash isolation and a possible security boundary when paired
with an OS sandbox.

Rejected for the first migration because it adds transport, latency, lifecycle,
and sandbox complexity before registry convergence. Preserve the ABI seam so an
untrusted tier can adopt this later.

### Option C — install-time generated catalogs

Setup resolves the graph and generates static catalogs; toggles take effect after
restart. This is deterministic and fast, but weakens the requested live TUI UX
and still requires a dynamic path for personal mods.

Use generated catalogs as build/CI evidence and an optional startup optimization,
not as the sole architecture.

## Canonical registry projections

One active mod graph produces all of these projections:

```text
installed manifests + desired config + grants + compatibility
                              |
                         resolver/lock
                              |
                       active ModRegistry
          +---------+---------+---------+---------+
          |         |         |         |         |
        CLI       TUI       MCP       Cesar     docs/help
          |         |         |         |         |
          +---------+---- execution/results ------+
```

A mod owns typed contributions for:

- top-level commands and aliases;
- slash commands, argument parser/schema, and completion metadata;
- intent/action identifiers and handlers;
- MCP tools and direct-call translation;
- Cesar routes, plan-step types, and orchestration tools;
- docs/help/guide sections;
- run/result types and formatters;
- emitted/subscribed lifecycle events;
- configuration schema/defaults/migrations;
- pressure-test declarations.

Duplicate public IDs are hard resolution errors. No source silently overrides a
kernel or first-party command. Compatibility aliases are explicit, versioned,
diagnosed, and never satisfy dependency requirements.

## Dependency and activation semantics

The dependency graph uses **mod IDs plus semantic-version ranges in v1**.
Capability-provider dependencies are deferred until there is evidence that
multiple interchangeable providers are required.

Rules:

1. Hard dependency cycles are invalid and prevent lock generation.
2. Enabling a dependency does not enable any dependent or suggested workflow.
3. Enabling a dependent previews the required dependency closure and enables it
   atomically after confirmation.
4. Disabling a dependency previews all active hard dependents and disables the
   entire reverse closure atomically after confirmation.
5. `--no-cascade` refuses a disable that would affect dependents.
6. Optional dependencies never block activation; integrations appear only when
   the provider is active.
7. Conflicts are hard failures with an actionable explanation.
8. Active jobs or sessions may veto immediate deactivation. The user can cancel
   them or schedule the transaction for the next safe point/restart.
9. JavaScript code cannot truly be unloaded. Runtime deactivation unregisters
   every surface and closes declared resources; complete memory unloading occurs
   on restart. The UI must not pretend otherwise.
10. Disable and uninstall retain config, data, history, ratings, and receipts.
    `agon mod purge` is a separate destructive operation with an exact preview.

## Installation and wizard experience

**PROPOSED target commands:**

```bash
npm install -g @kernlang/agon
agon setup --profile full

npx @kernlang/agon@latest setup --profile minimal --with think,review
npx @kernlang/agon@latest setup --interactive

agon mod list
agon mod info think
agon mod enable think
agon mod disable think
agon mod disable think --no-cascade
agon mod verify
agon mod doctor
agon mod rollback
```

npm cannot select arbitrary optional dependencies of one package with custom
flags. Therefore, custom npx setup is an installer operation: it resolves and
installs first-party mod packages into a managed `$AGON_HOME/runtime`/mod store,
writes a lock, and activates the chosen profile. It must not mutate the user's
project `package.json`.

Compatibility path:

- `npm install -g @kernlang/agon` remains valid.
- Existing users migrate to a `full-compat` profile that preserves every current
  command by default.
- Advanced users use the wizard or flags to install a smaller set.
- Package extraction follows API stabilization; the first registry slices may
  ship all first-party code in one tarball while already honoring activation.

The wizard presents capabilities and dependencies, not a wall of mode names:

1. Choose profile: minimal, maker, reviewer, researcher, full compatibility, or
   custom.
2. Expand families to individual mods.
3. Show required dependencies and optional recommendations.
4. Show package source, version, integrity, trust tier, permissions, disk size,
   and estimated live-engine/network needs.
5. Preview the exact install/activation transaction.
6. Apply atomically, run `mod verify`, and offer rollback.

## Scoped configuration and personal adaptations

**DECIDED v1 precedence:** user-global desired activation is authoritative. Repo
and private project files may configure already-enabled mods but do not
participate in activation, package installation, trust, or permission grants.

- Global config selects installed profile and user defaults.
- Repo `.agon.json` may provide settings for an already-enabled mod; it cannot
  request, enable, disable, install, or grant one.
- `.agon.local.json` contains personal per-project settings and remains gitignored;
  it also cannot change activation or trust.
- User/private executable mods live under `$AGON_HOME/mods`, outside the repo.
- Project directories are never auto-scanned for executable mods. An explicit
  development source/path can be selected and trusted through the user-global
  flow; opening a repository never imports its code automatically.
- Personal engines and existing `local-buddy-engines` remain outside versioned
  first-party packages.

Agon owns mod configuration in v1. A config adapter keeps future KERN-wide storage
possible without making it part of this release.

## Acceptance criteria

- [ ] One registry is the canonical source for CLI, TUI, MCP, Cesar, docs/help,
      results, events, and configuration surfaces.
- [ ] No disabled mod is reachable through a command, alias, slash parser, MCP
      tool, Cesar route, plan step, generated guide, or natural-language shortcut.
- [ ] Disabled attempts return a typed actionable error when a stale external
      caller invokes an unavailable ID.
- [ ] Enable/disable transactions are previewable, atomic, lock-protected,
      crash-recoverable, and reversible.
- [ ] Dependency cycles, conflicts, duplicate public IDs, incompatible API ranges,
      missing grants, and corrupt integrity fail closed.
- [ ] Enabling a dependency never silently enables dependents.
- [ ] Disabling a dependency handles its active reverse dependency closure as one
      explicit transaction.
- [ ] Current full installations migrate without losing commands, config, history,
      ratings, receipts, private engines, or personal adaptations.
- [ ] A minimal install boots, chats/asks, manages engines/mods, diagnoses itself,
      and can add mods without reinstalling the kernel.
- [ ] Every mod declares and passes contract, disable, dependency, package, and
      pressure tests.
- [ ] The 0.2.5 upgrade qualification gate remains runnable and green.

## Adversarial audit record

An Agon Nero audit challenged the recommendation after the first complete draft.
Its useful findings and dispositions are part of the spec rather than hidden:

| Challenge | Disposition |
|---|---|
| Citty/MCP clients can cache old discovery state. | **Accepted.** Atomicity now applies at the authoritative execution guard. Citty rebuilds next invocation; TUI/MCP/daemon hosts pin, drain, reload/restart, and reject stale dispatch; discovery notifications remain best-effort. |
| npm lifecycle hooks execute before manifest validation. | **Already required, retained.** Managed installs stage packages with lifecycle scripts disabled and reject first-party packages requiring them. |
| In-process permissions are not a security boundary. | **Already explicit, retained.** Tier 2 is full-code trust bound to source/integrity; repo config cannot grant it; untrusted executable mods wait for OS-isolated hosting. |
| “Behavior-neutral” conflicts with the first extracted mode. | **Clarified.** Registry/adapters ship as separate behavior-neutral slices; Think is the first later, intentionally visible modular release. |
| Persisted plans/history and downgrade were underspecified. | **Accepted.** Stable versioned contribution envelopes, pause-without-mutation, generic rendered history snapshots, compatibility windows, state backups, and downgrade fixtures are now required. |

The audit did not overturn the registry-first direction; it narrowed its security,
atomicity, and compatibility claims. A later Think/Brainstorm/Tribunal audit found
that the ecosystem was not yet implementation-ready beyond evidence work. The
subsequent executable contracts, ownership/DAG, persistence rules, budgets, and
coverage ledger close those locally resolvable specification blockers; production
implementation and release proof remain separate gates.

## Out of scope for the first implementation

- A public third-party marketplace.
- Claiming in-process executable mods are sandboxed.
- Hot-unloading JavaScript from memory.
- Allowing a repo to grant itself trust or permissions.
- Rewriting engine adapters at the same time as the mod registry.
- Running the live Multi-AI Build Pipeline without its separate budget handshake.

## Remaining decision points

All locally resolvable technical decisions are closed. Remaining choices do not
block beginning the implementation slices:

1. Final marketing labels and any future lean fresh-install recommendation.
2. Minimum macOS/Linux OS release numbers and Linux execution receipts on an
   available runner; architectures and Node floor are already frozen.
3. Proprietary third-party distribution/marketplace policy, which is outside v1.

## Supporting specifications

- [Manifest, registry, and activation contract](./modular-agon-runtime-contract.md)
- [Security, trust, packaging, and configuration](./modular-agon-security-and-distribution.md)
- [Migration and repeatable verification](./modular-agon-migration-and-verification.md)
- [Third-party authoring, build, and package contents](./modular-agon-authoring-build-and-packaging.md)
- [Blast radius, adversarial findings, and readiness blockers](./modular-agon-blast-radius-and-readiness.md)
- [Frozen contracts, evidence, package map, budgets, and coverage](./modular-agon-contracts-and-evidence.md)
