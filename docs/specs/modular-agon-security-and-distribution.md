# Modular Agon security and distribution

**Status:** FROZEN V1 SECURITY/DISTRIBUTION CONTRACT
**Date:** 2026-08-20

---

## Security thesis

A manifest is metadata, not a sandbox. In-process JavaScript can import Node APIs
unless execution is constrained by a real process/OS boundary. Modular Agon must
use capability APIs for least authority and auditability while describing its
trust boundary honestly.

Executable records and frozen decisions are indexed in
[`modular-agon-contracts-and-evidence.md`](./modular-agon-contracts-and-evidence.md).

## Threat model

The design must resist:

- a repository importing executable code merely because it was opened;
- path traversal or symlink escape from a declared package root;
- dependency confusion, package substitution, or integrity drift;
- a mod overriding a kernel/first-party command, alias, MCP tool, or config key;
- manifest fields that grant permissions without user approval;
- install lifecycle scripts executing arbitrary code;
- a dependency update silently broadening permissions;
- a disabled mod retaining hooks, timers, routes, tools, or prompt fragments;
- a crash leaving half-applied activation/config state;
- secrets entering manifests, locks, receipts, logs, or diagnostics;
- a repo config elevating machine-global trust;
- downgrade/rollback interpreting newer state unsafely;
- prompt content activating a mod that was not explicitly selected.

## Trust tiers

### Tier 0 — kernel

Code shipped as the Agon kernel. Always active and covered by the complete release
gate. It does not use the external dynamic loader.

### Tier 1 — first-party mod

Published by KERNlang, package identity allowlisted, integrity pinned, manifest
compatible, and covered by first-party contract/pressure tests. It may execute
in-process through the mod API.

### Tier 2 — explicitly trusted executable mod

Installed by the user from npm, a local directory, or a private source. Before
first execution, Agon displays source, resolved real path, version, integrity,
entrypoints, requested permissions, and the warning that in-process execution is
full code trust. Approval is bound to package identity plus integrity; an update
with changed code or permissions requires renewed approval.

The trust record is user-owned under `$AGON_HOME`, written through the approval
flow, and keyed by normalized package/source plus integrity. It is never read from
a repository config. Deleting or editing a repo cannot create a Tier 2 grant.

V1 never grants publisher-wide executable trust. The record binds exact source,
registry origin, normalized package name, provenance identity/status, version,
manifest hash, and content hash. Missing npm provenance is displayed and requires
the same explicit full-code approval; invalid provenance fails. Publisher/source/
provenance change is a new decision. Offline runs may reuse an exact previously
trusted frozen artifact unless a locally cached revocation rejects it; new install
or update requiring registry/provenance metadata fails offline with the complete
missing evidence set.

### Tier 3 — explicitly selected declarative mod

Contains only schemas/data supported by the kernel: engine JSON, prompt/skill
text, docs, configuration defaults, and other non-executable contributions. It is
validated and cannot reference handlers. It may be selected from a user folder or
explicit path, but projects are never auto-scanned and repository config cannot
activate it.

### Tier 4 — untrusted executable mod

Not executable in-process. A future isolated host may support it through a
versioned RPC protocol and OS-enforced filesystem/network/process restrictions.
Worker threads alone are not accepted as a security boundary.

## Permission model

Manifest permissions are requests. Effective grants are the intersection of:

1. kernel policy;
2. trust-tier maximums;
3. user grants;
4. repo/user deny rules;
5. per-operation approvals where required.

Permission categories include:

- engine dispatch and allowed modes;
- filesystem read/write roots expressed as symbolic scopes;
- process execution with command-family policy;
- network hosts/protocols;
- secret identifiers (never secret values);
- configuration namespace access;
- event emit/subscribe namespaces;
- job/background service creation;
- browser/client capability access;
- destructive action classification.

Capability wrappers enforce policy and produce receipts. For Tier 2 code they are
guardrails, not containment; direct Node imports remain possible and are covered
by the explicit full-trust warning.

## Loader hardening requirements

- Parse with a strict schema and object-depth/size limits.
- Reject dangerous object keys such as `__proto__`, `prototype`, and
  `constructor` in untrusted structured input.
- Normalize package identity before dependency resolution.
- Resolve package root and every referenced file through `realpath`.
- Require target containment within the verified root.
- Reject absolute paths, traversal, URL/data imports, and unsupported file types.
- Verify package-manager integrity and the lock record before import.
- Never use last-wins semantics for IDs or public contributions.
- Never allow external mods to replace kernel entries.
- Import only mods in the resolved active graph.
- Use a fresh activation owner token so registrations cannot impersonate another
  mod.
- Track every disposer/timer/subscription/job/resource by owner.
- Fail activation if cleanup registration is missing for a persistent resource.
- Bound startup and activation time; record timeouts and errors.
- Keep load failures isolated to the mod when the kernel can continue safely;
  dependents become blocked with a reason chain.

## Install safety

The managed installer:

1. resolves only configured registries/sources;
2. reads registry metadata under an explicit online policy, or reads only the
   verified local cache in frozen-offline mode;
3. creates a deterministic package/version/source/permission plan before package
   download, extraction, or durable state mutation;
4. rechecks the input generation/fingerprint under the writer lock before apply;
5. installs into a staging prefix outside the current project;
6. disables npm lifecycle scripts by default (`--ignore-scripts` equivalent);
7. rejects first-party packages that require install scripts;
8. verifies name, version, manifest, dependency closure, integrity, compatibility,
   provenance status, and trust;
9. computes permission deltas before activation;
10. commits lock/config through the immutable-generation protocol;
11. retains the previous generation for rollback;
12. runs offline contract verification before declaring success.

Lifecycle scripts being disabled does not imply that native or optional support
silently disappears. A required setup step is a separate typed transaction:
previewed, explicitly approved, source/integrity-bound, time/output/path bounded,
receipt-producing, and rollback-aware. Arbitrary package scripts are never
reclassified as trusted setup actions. The current root patch/Python postinstall
is migration evidence that must be assigned explicit ownership before the target
installer is considered complete.

No setup flag may embed or print an API key. Provider credentials remain in the
existing auth store/indirection and are referenced by identifier.

## Package topology

### Target topology

```text
@kernlang/agon                 CLI/kernel and setup entrypoint
@kernlang/agon-mod-api         public types/schema only
@kernlang/agon-mod-think       first-party mod
@kernlang/agon-mod-forge       first-party mod
@kernlang/agon-mod-tribunal    first-party mod
...                            additional first-party mods
```

The current package name and `agon` binary remain compatible. A custom setup does
not edit the user's project dependencies; it installs packages into an Agon-owned
prefix under `$AGON_HOME` and records them in the mod lock.

### Staged topology

Immediate package splitting creates avoidable release/ABI risk. The migration may
first create workspace-internal mod packages bundled into the existing tarball.
Activation and surface ownership must already be real. After Mod API v1 is frozen,
every user-toggleable first-party mod is published as its own package. The staged
monolith is an implementation checkpoint only; it is not the completed modular
release.

First-party kernel/API/mod packages use a lockstep version and release-set/BOM in
v1. Independent first-party versioning is deferred until clean-room installation,
rollback, and compatibility evidence make it safe.

### Direct npm use

Supported paths should include:

```bash
npm install -g @kernlang/agon
agon setup --profile full-compat
```

and for custom installs:

```bash
npx @kernlang/agon@latest setup \
  --profile minimal \
  --with think,review,research \
  --without forge,goal,conquer
```

Plain global installation installs the current recommended complete first-party
set. Custom setup installs the selected physical packages plus their required
support closure. Changing the recommended set in a future release affects fresh
installs only; an existing desired state is not silently rewritten.

V1 uses the kernel package's `setup` command. A separate thin installer is deferred
and may be introduced later without changing resolver or state contracts.

## Profiles

Profiles are versioned desired-state documents. They may select mods and seed
defaults, but cannot contain secrets or trust grants.

Candidate profiles:

- `minimal`: kernel, ask/chat, engine/provider management, mods, Doctor.
- `maker`: plan/build, think, review, Forge family, mutation.
- `reviewer`: think, review, mutation, tribunal/nero.
- `researcher`: think, research, RAG, browser, synthesis.
- `full-compat`: every feature exposed by the pre-modular release.
- `custom`: explicit user selection.

Updating a profile definition never silently changes an existing installation.
The lock retains the applied profile generation; `agon mod profile update` shows
the delta and requires an activation transaction.

## Config scopes

### Global

Stores desired profile, selected/disabled mods, version constraints, and user
settings. Trust and grants are machine/user-owned and cannot be supplied by repos.

### Repository

May provide settings only for mods already enabled by the user-global desired
state. It cannot request, enable, disable, install, approve, or grant a mod; grant
secrets; broaden filesystem/network access; or remove a global deny merely by
being opened.

### Private repository override

`.agon.local.json` remains the strongest personal settings layer and is
gitignored. It may change personal per-project settings for an already-enabled
mod, but cannot select one or change trust/permissions.

### Merge rules

- Deny wins.
- Trust/grants never originate from a repo.
- Activation is user-global; repo/private project layers do not merge activation
  sets at all.
- Mod settings deep-merge only according to the owning schema.
- Invalid values fail with scope and path; they do not silently disable safety.
- Unknown config for absent/disabled mods is retained but not applied.

## Personal and private adaptations

- Personal executable mods belong under `$AGON_HOME/mods` or another explicit
  user source, never in first-party package directories.
- Repo-private settings for already-enabled mods belong in `.agon.local.json`.
  Executable/declarative mod code remains in a user-global source or an explicitly
  selected development path, never an auto-discovered repo directory.
- Existing personal engines, `local-buddy-engines`, worktrees, auth, ratings, and
  history are migration inputs, not cleanup targets.
- Setup and uninstall preview exact paths. Broad globs and home-directory deletes
  are forbidden.
- Disabling or uninstalling a mod does not delete its data. Purge is explicit,
  scoped, previewed, and recoverable where practical.

## Updates and rollback

- First-party packages release lockstep in v1; explicit API/schema compatibility
  ranges still govern one resolved graph and permit future independent versioning.
- Kernel self-update and mod-graph update are distinct transactions. A successful
  `npm install -g` does not by itself prove atomic graph activation or rollback.
- Candidate graphs live in immutable generation directories. Running invocations
  pin their generation; new processes adopt the new current pointer only after
  verification. Long-lived hosts drain/restart or report restart-required rather
  than silently mixing generations.
- An updater resolves the whole candidate graph before replacing any package.
- Permission expansion, new entrypoints, trust changes, or source changes require
  approval even when semver permits the update.
- The previous lock/config/package generation remains available until the new
  graph passes verification.
- Rollback restores package pointers, lock, activation, and config schema snapshot.
- Destructive/down migrations are forbidden by default; config migrations should
  be additive/reversible or retain a versioned backup.
- A newer linked source checkout is never overwritten by an updater.
- Persisted plans, jobs, results, and mod config carry schema versions and stable
  contribution IDs. Package file paths and export names are not persisted.
- The release that introduces registry projection retains the legacy adapters;
  the release that migrates the first vertical mod retains a downgrade-compatible
  state backup and reader. Legacy implementations are removed only after the
  declared compatibility window and a tested downgrade path.

## Audit receipts

Every mod transaction records:

- requested operation and invoker surface;
- prior/candidate graph hashes;
- packages/source/version/integrity;
- dependency and reverse-dependency changes;
- permission deltas and approval references;
- migrations;
- activation/deactivation order;
- contract/smoke results;
- rollback status;
- failure diagnostics without secrets.

Every orchestration run records active mod IDs/versions and graph hash alongside
engine/model provenance. This permits reproduction and explains why a mode was or
was not available at that time.

## Security acceptance criteria

- [ ] Opening a repository never imports executable repo mod code.
- [ ] No manifest field grants authority by itself.
- [ ] Realpath containment and integrity are checked before import.
- [ ] Package lifecycle scripts are disabled in managed installs.
- [ ] Duplicate IDs/collisions fail closed; no last-wins override remains.
- [ ] A repo cannot elevate trust, permissions, secrets, or global policy.
- [ ] Disabled mods retain no registered hooks/tools/routes/resources.
- [ ] Tier 2 UI explicitly states that in-process code is fully trusted.
- [ ] Untrusted executable mods are rejected until a real isolated host exists.
- [ ] Locks, receipts, logs, and Doctor output contain no secret values.
- [ ] Transactions are atomic and have tested crash rollback.
