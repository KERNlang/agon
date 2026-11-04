# Modular Agon Slice S3 — desired state, profiles, activation, and grouped UI

## Status and authority

Slice S3 implements the non-shipping user-global desired-state and activation
boundary on top of the S2 durable host. The legacy runtime remains authoritative
until the generated-surface cutover in S6. The active/global Agon installation
and personal state are outside this implementation and its tests.

The 49-package map remains authoritative. Mod IDs such as `agon.think` are the
user-facing identities; npm package IDs such as `@kernlang/agon-mod-think` are
physical resolution identities. Thirty-six first-party mods are toggleable. The
kernel, public Mod API, and default-enabled hidden support packages are implicit;
the optional SaaS support package is absent unless a later selected package
requires it.

## Desired state and profiles

Desired state is a strict, canonical, versioned document containing explicit
selected and disabled mod IDs, version constraints, the previous-state hash, and
an applied-profile snapshot. Arrays and constraint keys are ASCII-sorted and
unique. Selected and disabled sets are disjoint. Unknown fields, unknown mod IDs,
invalid semver ranges, and non-canonical timestamps fail closed.

Applying a profile copies its complete expansion into desired state and binds it
to the canonical definition hash. Editing a named profile later cannot silently
change an existing installation. A forged or stale applied-profile hash is
rejected. Profiles may seed mod settings, but never contain installation trust,
capability grants, or secrets.

The public Mod API publishes executable Zod validators and draft-2020-12 JSON
schemas. JSON Schema provides the portable structural contract. The executable
validators additionally enforce canonical ordering, disjoint sets, and semver;
the kernel additionally verifies applied-profile content hashes and catalog
membership.

## Dependency and activation semantics

- Enabling a child includes its hard parent and transitive package closure.
- Enabling a parent never enables optional child workflows.
- Disabling a parent previews and removes all selected reverse dependents.
- `noCascade` refuses the change while a dependent remains selected.
- Explicitly disabling a required dependency fails closed.
- First-party defaults reproduce the existing full-compatible 36-mod state.
- Third-party IDs fail closed until the S8 trust and folder-mod path exists.
- Repository configuration can tune an already-effective mod only. Activation,
  installation, profile selection, trust, and grants remain user-global.
- Settings for disabled or unknown mods are retained without being applied, so
  re-enabling or installing a mod does not destroy its configuration.

Preview binds the desired-state revision/hash and selected generation. Apply
rechecks both before work and checks the expected generation again inside the S2
writer fence, closing the preview-to-lock race. The candidate canonical lock is
bound to the exact next desired-state hash before the pointer can move. New
sessions observe the new generation; pinned TUI, MCP, daemon, room-watcher, and
browser hosts receive restart-required semantics. Rollback restores both the
prior generation pointer and its exact desired-state snapshot.

## Grouped UI contract

The generated hierarchy contains every first-party mod exactly once and keeps
kernel management actions visibly non-toggleable. Parent/child relationships are
nested. Disabled built-ins remain visible, greyed, and non-callable. Blocked
entries expose a typed reason, plain-language message, and recovery action.

The UI projection supplies stable focus order, arrow/Home/End navigation,
semantic labels, textual status, and a readable plain-text fallback. Status is
never conveyed by color alone. The hierarchy generator and consistency checker
reject missing or duplicate first-party entries; this caught and repaired the
previously omitted Campfire entry.

## Executable evidence

```bash
npm run test:modular-state
npm run test:modular-ui
npm run test:modular-ui-accessibility
npm run spec:modular-slice3:self-test
npm run perf:modular-slice3
npm run spec:modular-slice3:qualify:index
```

The state matrix exercises all 36 enable closures and all 36 disable/reverse
closure cases. Activation tests cover stale preview, stale in-fence generation,
lock/state mismatch, rollback, previous-generation operation, re-entry, and
restart semantics. Negative controls prove that forged profile hashes, disabled
dependencies, stale plans, callable disabled entries, missing accessibility
metadata, repository activation, and incomplete UI ownership turn the gate red.

Native macOS arm64 planning and grouped-view measurements are recorded in
[`evidence/modular-agon-slice3-performance.json`](./evidence/modular-agon-slice3-performance.json).
The frozen local S3 budgets are 5 ms p95 for both deterministic planning and
full grouped-view projection. Other native platform cells remain S9 release
qualification and are not claimed here.

## Rollback and next boundary

S3 can roll back atomically to the previous S2 generation and desired-state
snapshot. Removing the S3 exports leaves the legacy runtime unchanged because
no legacy surface dispatches through the modular activation service yet.

S4 may begin only after the S3 clean committed receipt passes independently. It
will physically extract the eleven hidden support packages while keeping these
state, resolution, activation, UI, and rollback contracts stable.
