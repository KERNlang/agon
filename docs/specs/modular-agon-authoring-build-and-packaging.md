# Modular Agon authoring, build, and packaging contract

**Status:** FROZEN V1 AUTHOR/PACKAGE CONTRACT
**Date:** 2026-08-20

---

## Purpose

This document defines the boundary an independent mod author can rely on and the
files Agon authors, builds, publishes, installs, and generates. The contract is
required before first-party code is split into separately published packages;
otherwise the split only moves files while preserving private imports, duplicate
kernel instances, and static catalogs.

Executable contracts and evidence are indexed in
[`modular-agon-contracts-and-evidence.md`](./modular-agon-contracts-and-evidence.md).
Current build facts remain labeled **VERIFIED**.

## Current package evidence

- **VERIFIED:** `packages/cli/tsup.config.ts` produces three entries: the CLI,
  bundled MCP server, and browser native host. It inlines Core, Forge, and the CLI
  adapter. Independently selectable first-party mods therefore cannot remain in
  those static imports after package extraction.
- **VERIFIED:** built-in engine JSON is copied to both `dist/engines` and
  `dist/mcp/engines`. This is packaging duplication, not two authorities.
- **VERIFIED:** `@kernlang/agon` publishes `dist`, two Python probe files, README,
  and LICENSE. It has no public TypeScript export or declaration contract.
- **VERIFIED:** Core, Forge, and Adapter CLI publish ESM plus declarations, but
  their current package relationships are implementation relationships, not a
  stable third-party Mod API.
- **VERIFIED:** the root postinstall runs `npx patch-package` and optional Python
  setup. Managed mod installs that disable lifecycle scripts cannot depend on
  that behavior.
- **VERIFIED:** the updater replaces the global CLI with `npm install -g
  @kernlang/agon`. This is not an atomic update of a kernel plus locked mod graph.
- **VERIFIED:** `scripts/install-test.sh` proves the existing monolithic tarball
  and transitive Python sidecars, but not selectable packages, offline resolution,
  graph rollback, or third-party compatibility.
- **VERIFIED:** a 2026-08-20 `npm pack -w packages/cli --dry-run` contains 197
  entries and approximately 7.4 MB unpacked. It includes feature-named chunks,
  bundled MCP, browser host, two engine JSON trees, source maps, and Python probes.
  This is the compatibility baseline, not evidence of physical modularity.

## Public author surface

Mods import only `@kernlang/agon-mod-api`. They must not import the CLI, Core,
Forge, Adapter CLI, MCP, another mod's implementation, or an `internal`/deep path.

The Mod API package contains:

- manifest schemas and generated TypeScript types;
- `AgonModFactory`/`AgonModV1.activate()` types and capability interfaces;
- contribution schemas and stable error/result envelopes;
- test doubles and an in-memory conformance host;
- compatibility negotiation helpers;
- no kernel singleton, global registry, provider credentials, or feature code.

The package has an explicit `exports` map. Unexported files are private even when
npm places them on disk. First-party CI uses the same public imports as external
mods and rejects deep imports mechanically.

The Mod API is versioned independently from the kernel. A manifest declares a
supported Mod API semver range. The kernel checks that range before importing
code and fails with `incompatible-mod-api` rather than relying on TypeScript
compile-time compatibility. Breaking removals require a declared deprecation
window and compatibility fixture.

`@kernlang/agon-mod-api` is a types/protocol package, not the runtime host. A mod
must not install its own executable kernel. This avoids two registries caused by
nested copies of Core. Runtime registration always receives the one host-owned
registrar and `ModServices` instances.

## Canonical author package

The initial ESM-only package shape is:

```text
package.json                         static, published
agon.mod.json                       static, published
README.md                           static, published
LICENSE                             static, published
schemas/*.json                      static, published when declared
docs/*.md                           static, published when declared
assets/**                           static, published when declared
verification/contract.json          static, published
verification/smoke.json             static, published
dist/index.js                       built, published
dist/index.d.ts                     built, published
dist/*.js                           built chunks, published when referenced
dist/*.js.map                       built maps, optional publication
src/**                              authored source, not required at runtime
tests/**                            development-only
coverage/**                         development-only
node_modules/**                     never published
```

The fixed manifest filename is `agon.mod.json`. `package.json` contains:

```json
{
  "type": "module",
  "agon": { "manifest": "./agon.mod.json" },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./manifest": "./agon.mod.json"
  },
  "peerDependencies": {
    "@kernlang/agon-mod-api": "^1.0.0"
  },
  "files": [
    "agon.mod.json",
    "dist",
    "schemas",
    "docs",
    "assets",
    "verification",
    "README.md",
    "LICENSE"
  ]
}
```

These paths are frozen for v1. CJS and arbitrary package entrypoint probing are
not supported.

## File taxonomy

| Class | Examples | Build/install rule | Removal/retention rule |
|---|---|---|---|
| Authored source | `src/*.ts`, author tests | Compiled by author/first-party build; never executed from an npm cache path | Not required after install |
| Static package metadata | `package.json`, `agon.mod.json`, schemas, permissions, verification metadata | Copied byte-for-byte and readable before code import | Removed with package generation; retained in transaction receipt by hash |
| Static content/assets | docs, templates, prompt text, JSON, images, WASM, platform sidecars | Must be declared, size-bounded, integrity-covered, and contained in package root | Content-addressed bytes may remain while referenced by a generation |
| Built executable | ESM entry, private chunks, declarations | Every runtime-referenced file must be present, integrity-covered, and reachable from the declared entrypoint/manifest; only public consumer entrypoints belong in `exports`; no runtime TypeScript compilation | Immutable within one installed generation |
| Generated build evidence | API report, contribution index, SBOM, provenance | Generated reproducibly in CI; compared to manifest and tarball | Release evidence retained according to release policy |
| Runtime state | locks, grants, desired config, receipts, history, ratings, sessions, plans, results | Created only under Agon-owned data/config roots; never shipped in a mod tarball | Disable/uninstall retains it; purge is separate and previewed |
| Runtime cache | extracted packages, downloads, compiled cache, temporary staging | Content-addressed or generation-scoped; never authoritative | Garbage-collected only when no generation/artifact lease references it |
| Secrets | provider tokens, credential handles | Never package/manifest/lock/receipt content; only opaque identifiers cross the Mod API | Owned by credential store policy |
| Development debris | coverage, `.tsbuildinfo`, caches, logs, worktrees, local config | Rejected by pack verification | Never installed |

Static does not mean trusted. It means Agon can parse and verify the artifact
without executing the mod's JavaScript. Executable bits, symlinks, Unicode/case
collisions, maximum expanded size, and every path are validated after extraction.

## Registration and side effects

The executable entrypoint exports the default `AgonModFactory`. Importing
the entrypoint must not intentionally register globals, mutate Agon state, start
timers, open sockets, spawn processes, or perform network/file writes.

```ts
const createMod: AgonModFactory = async () => ({
  apiVersion: '1',
  activate(registrar, services) { /* registrations */ }
});
export default createMod;
```

`activate()` may only contribute IDs declared by the verified manifest. The host
tags all registrations with an unforgeable activation owner. Every persistent
resource returns a disposer.

The no-top-level-side-effects rule is an author contract and verification target,
not a security boundary. Candidate code is imported first in a disposable
subprocess with time, output, handle, and mutation checks. Passing that smoke test
does not make hostile in-process code safe; Tier 1/2 trust remains required.

`sideEffects: false` is permitted only when the pack test proves every module is
side-effect-free. Otherwise the package lists exact side-effectful files. The
field is a bundler optimization statement, not a permission declaration.

## Assets and non-JavaScript runtimes

Manifests declare each runtime asset with relative path, media/type, size,
integrity, platform/architecture conditions, executable-bit expectation, and the
contribution that consumes it.

- WASM is a static integrity-covered artifact. Using WASM as implementation does
  not imply isolation; an isolation claim requires a specified host and imports.
- Native binaries use explicit platform/architecture packages or prebuilt assets.
  Unsupported platforms fail compatibility before activation.
- Python is an explicit optional capability/setup component with a version probe,
  dependency strategy, and fallback. It must not silently pip-install during mod
  discovery or activation.
- Download-on-first-run assets require a separate approved network transaction,
  content hash, quota, and offline failure mode. They are not disguised install
  scripts.

## Declarative-only package profile

A Tier 3 package/directory uses the same static identity and schema rules but:

- omits `entrypoints` and executable exports;
- contains no JavaScript, native executable, Python, or executable WASM handler;
- may contribute only allowlisted kernel-parsed schemas/data such as engine
  definitions, prompt/skill text, docs, defaults, and templates;
- cannot declare process/network/secret/filesystem-write permissions or lifecycle
  hooks;
- is rejected rather than silently upgraded to executable trust when any handler,
  script, dynamic template, or unsupported contribution appears.

Its canonical `package.json` exports only `./manifest` and declared static content.
Declarative mods may be explicitly selected from a directory through the
user-global flow, but use identical manifest/path/size/integrity validation.
Repositories are never auto-scanned and opening one never triggers npm resolution.

## Transitive dependency closure

Full-code trust applies to the mod and all executable production dependencies it
loads. The resolver therefore locks and receipts the complete production closure,
not only the top-level mod tarball.

- Allowed sources are registry tarballs and explicitly configured local/linked
  sources. Git URLs, HTTP tarballs, mutable tags, workspace/file references in a
  published package, and undeclared runtime downloads are rejected in v1.
- Lifecycle scripts remain disabled for the entire closure. A dependency needing
  a script/native build follows the explicit asset/setup-action policy.
- Lock evidence includes package identity, registry/source, version, tarball
  integrity, extracted tree hash, license/provenance status, and dependency edges.
- Bundled dependencies are inventory/hash-covered and shown as part of the mod's
  trust surface; they are not invisible implementation detail.
- Peers other than the public Mod API and explicitly allowed shared protocol
  packages are rejected or resolved by a specified host policy. A peer cannot
  smuggle in Core/Forge/CLI/MCP or another kernel.
- Any closure change that alters executable bytes, publisher/source/provenance,
  lifecycle/native requirements, or permissions invalidates prior Tier 2 approval.
- Dependency deduplication is an installation optimization. It never changes mod
  identity, ownership, receipt attribution, or generation immutability.

## Build and pack contract

Every first-party and publishable third-party mod must pass:

1. clean TypeScript build against the oldest supported Mod API;
2. declaration build and public API compatibility check;
3. no-private-import and no-cross-mod-implementation import checks;
4. manifest-to-registration contract validation;
5. `npm pack --dry-run` allowlist validation;
6. clean-room install from the produced tarball with scripts disabled;
7. offline activation from a fully populated managed cache;
8. missing-chunk/static-asset scan against manifest and ESM imports;
9. import-without-registration subprocess smoke;
10. activation/deactivation/disposal conformance;
11. license, SBOM, provenance, and integrity generation for first-party release;
12. platform fixtures for every declared platform-specific asset.

Verification metadata is input to the host runner, never an author-issued pass.
The versioned schema declares applicable platforms, fixture IDs, expected
contribution IDs, and bounded setup/invocation hints. Mandatory host-owned checks
(schema, containment, integrity, import/registration bounds, disposal, disabled
sweep, and receipt validation) cannot be removed by the package. The runner emits
a signed/hashed receipt containing runner/schema versions, graph/package hashes,
platform, bounds, observations, and failures. Unknown newer verification schemas
fail closed with an upgrade hint.

Source maps may be published without `sourcesContent`, matching the current
private-source posture. The policy must be consistent per release and Doctor must
still map errors to package/version/entrypoint without exposing source.

## Build topology transition

The migration cannot keep independently selectable features statically inlined
in `@kernlang/agon` indefinitely.

1. Registry-first slices may retain internal workspace packages in the CLI
   tarball while proving real activation and projection ownership.
2. Before separately publishing a mod, its executable entry leaves the CLI tsup
   import graph and becomes an immutable package loaded from the resolved store.
3. The kernel/CLI bundle contains the host and Mod API adapter, not Forge or other
   feature implementations.
4. MCP becomes a host surface that loads the same resolved graph; it must not
   embed a second feature catalog or a private copy of selectable mods.
5. Engine definitions gain one static authority and one locator contract. The
   current two copied directories may remain as generated outputs temporarily,
   but their bytes/index must be verified identical.
6. Python probes/sidecars are classified explicitly as kernel support, a specific
   mod asset, or an optional setup component. Location must follow ownership.

## Installation modes

| Mode | Required behavior |
|---|---|
| Global CLI | Kernel binary may be global; mutable mod generations live in a user-writable Agon store, not the global npm directory |
| `npx` | Ephemeral package/cache paths are never recorded as installed mod roots; setup copies/verifiably installs into the managed store or delegates to an installed compatible kernel |
| Local/project invocation | Does not mutate project dependencies unless explicitly requested; repo config cannot install/execute code on open |
| `npm link`/workspace | Marked `linked-development`; never overwritten by updater; realpath and source hash are re-evaluated; not silently treated as release provenance |
| Offline | Frozen lock succeeds only if every required tarball/metadata/asset exists and verifies; otherwise reports the complete missing set before mutation |
| Proxy/private registry | Honors npm registry/auth/proxy/CA configuration without copying credentials into Agon state or logs |
| Portable | Uses an explicitly selected Agon home and never mixes state accidentally with global installation |

Candidate source precedence is deterministic and recorded: explicit development
path, user folder, configured registry, then bundled compatibility package.
Committed/frozen generations are read from their exact lock and are not another
precedence level. Reserved first-party IDs reject non-first-party sources unless
the user explicitly selected a development path. No ambient `node_modules` scan
may inject a mod; canonical IDs are lowercase ASCII and reject normalization-
dependent collisions.

## Author tooling

The supported author loop is:

```bash
npx @kernlang/create-agon-mod my-mod
agon mod dev ./my-mod
agon mod validate ./my-mod
agon mod test ./my-mod
agon mod pack ./my-mod
agon mod inspect ./my-mod.tgz
```

The scaffolder provides a minimal manifest, TypeScript config, sample command,
contract tests, and no-private-import lint rule. `mod dev` creates a visibly
linked development record and uses the same resolver/registry projection as a
release package. It never copies code into first-party package directories.

The SDK documentation must define lifetimes, cancellation, streaming/backpressure,
errors, logging/redaction, config migration, persistence schemas, permissions,
and disposal—not only registration method names. At least one example mod is
maintained outside the Agon monorepo and tested against the published tarballs.

## Release topology

- First-party kernel and mod package releases are lockstep in v1 and carry one
  release-set/BOM. Mod API, manifest, lock, verification, and persisted-payload
  schema versions remain explicit and may evolve under their compatibility rules.
- Publication order is API, kernel compatibility metadata, mods, then profile
  definitions/catalog. Partial publication never becomes the default profile.
- A first-party release candidate is installed from packed tarballs in a clean
  environment; workspace resolution is not release evidence.
- Package provenance/integrity and publisher identity are recorded. npm integrity
  proves bytes, not trust; the installer still shows publisher/source and trust.
- Yanked/deprecated versions remain readable for locked rollback within the
  retention window. Resolver behavior for yanked/prerelease versions is explicit.
- Mod API v1 guarantees additive compatibility throughout Agon 1.x. A breaking
  Mod API requires a new major API version; deprecated members remain for at least
  two minor Agon releases and six months, whichever is longer.

## Deferred release and product inputs

1. Minimum supported macOS/Linux OS release numbers remain a release/product
   choice; v1 architecture cells are darwin/linux × arm64/x64 and Node >=22.
2. A separate `create-agon` package is deferred; v1 uses the kernel package's
   `setup` command and may extract a thin installer later without changing state.
3. Source maps publish without `sourcesContent` for first-party packages. Policy
   for proprietary third-party distribution remains a future ecosystem choice.
4. npm is the v1 managed-store resolver/pack compatibility implementation behind
   an adapter; changing it later must reproduce canonical lock inputs/bytes.

## Acceptance criteria

- [x] A compile-only external fixture builds using only the public Mod API types;
      release qualification repeats this against published tarballs.
- [ ] A mod can build in a separate repository using only published Mod API docs,
      types, schemas, and test tools.
- [x] The executable fixture's packed contents are explicit and checked to contain
      every referenced executable/static asset and no runtime/development state;
      production packages repeat the same contract at implementation time.
- [ ] Manifests are discoverable and resolvable without importing executable code.
- [ ] Loading a mod cannot create a second kernel/registry instance.
- [ ] Global, npx, linked, offline, proxy/private-registry, and supported-platform
      behavior have clean-room tests.
- [ ] Current bundled MCP/Forge/Core boundaries are replaced or explicitly
      retained only in behavior-neutral migration slices.
- [ ] Lifecycle scripts are unnecessary for managed mod installation; approved
      setup actions are explicit, typed, receipt-producing, and rollback-aware.
- [ ] The complete production dependency closure is locked, integrity/provenance
      inventoried, script-free, and included in the trust/reapproval decision.
- [ ] Executable and declarative-only package profiles pass distinct conformance
      suites; a declarative package cannot smuggle a handler.
