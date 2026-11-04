# Modular Agon Slice 5 implementation

Slice 5 creates every frozen first-party mod as a physical package while the
legacy runtime remains the execution authority until the generated-surface
cutover in S6. This is deliberate: S5 proves package, ownership, dependency,
disable, persistence, and rollback boundaries without allowing two dispatch
systems to become authoritative at once.

## Physical package contract

All 36 `packages/mod-*` packages contain a validated manifest, public Mod API
entrypoint, configuration schema, ownership asset, independent TypeScript build,
explicit dependency list, and pack allowlist. Contributions register only
through an owner-tagged `Registrar`. The temporary compatibility runtime is
injected per invocation and is never stored in a process-global bridge. Direct
activation without that runtime fails closed with `MOD_RESTART_REQUIRED`.

The package generator is deterministic and checked for drift. Its pack test
builds every package in topological order, dry-packs it, verifies exact contents
and asset hashes, imports it, registers every declared contribution, checks all
five projections, disposes the owner, and proves disabled owners cannot register.

## Ownership and migration

The S5 migration ledger maps all 344 mod-owned inventory assignments to one of
the 36 physical packages. It preserves the original source locator as the S5
compatibility adapter, identifies the physical entrypoint and ownership asset,
and records the S6 removal condition. Eighty-six assignments cover config,
state paths/stores, events, and historical result/envelope readers.

RAG storage and result types are the first business implementation physically
moved into their owner package. The old core files are narrow deprecated
re-exports, and focused conformance tests prove the move preserved behavior.
The inventory generator scans physical mod implementation files but excludes
generated mod entrypoints so embedded ownership metadata cannot recursively
invent new surfaces.

## Disable and dependency behavior

The disable matrix starts from the full-compat profile and disables each of the
36 mods once. For every case it applies the frozen reverse-dependency cascade,
constructs a registry from only effective owners, and proves the disabled root
and every cascaded dependent are unreachable. Parent/child rules remain those
qualified in S3: a child requires its parent; a parent does not require its
child.

## Acceptance and rollback

S5 acceptance consists of the physical package/pack verifier, the 36-case
disable matrix, the frozen 160-workflow and raw-envelope oracle, package data
migration verification, full repository tests, typecheck, lint, generated drift
checks, and measured imports of all 36 packages. Negative controls accompany
package dependency validation, disable reachability, data coverage, legacy
oracle boundaries, and rollback-subject discovery.

### Acceptance correction: a registered ID is not behavioral extraction

The post-cutover audit found that the original gates could pass when a physical
package registered the right owner and contribution IDs but exposed a reduced
CLI contract or a reduced workflow. Examples included missing Review mutation
options, a generic Goal input, one shared History/Last schema, and generic
Routing Docs arguments. Those are false greens: package existence, generated
reachability, and disablement do not prove that the package preserved the
feature it replaced.

S5 therefore also requires exact recursive CLI contract parity for every
first-party command (argument names, positional/required shape, aliases,
defaults, and nested commands) and behavior tests for every argument that
changes execution. Schema-only repairs are insufficient. Full workflow bodies
move into the owning mod or an appropriate hidden support package. Narrow typed
host ports are permitted only for genuine host machinery such as browser
session hosting, process supervision, or workspace I/O; they may not delegate
an entire legacy feature under a generic command/service-locator API. Each
temporary adapter retains an explicit removal condition and remains a red final
release cell until removed.

The immutable resolved registry in `@kernlang/agon-kernel` remains the sole
owner of enablement and all five surface projections. CLI-only presentation
helpers stay mod-local; a helper moves to a hidden support package only when it
has a coherent cross-mod responsibility. Existing argv contracts remain
compatible without a hard break. The parity and disablement gates run in normal
CI as well as release qualification. Host ports are bounded by cohesive typed
capabilities, cancellation/error/lifecycle contracts, and import-boundary
checks rather than an arbitrary method count.

Rollback selects the retained qualified S4 commit. That subject contains no S5
mod package other than the already-qualified Mod API/kernel foundation and does
not import the S5 RAG owner. Re-entry restores the S5 adapter and requalifies the
same package and oracle gates. S6 may not begin until S5 has a clean committed,
subject-bound review and qualification receipt.
