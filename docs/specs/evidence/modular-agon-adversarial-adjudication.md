# Modular Agon adversarial-review adjudication

This is the repository-local receipt for the required Agon Think, Brainstorm,
Tribunal, and final independent review. The historical run artifacts were read
without modification. No model claim became normative merely because a model
made it; every accepted claim below was checked against the current source/spec
or executable evidence.

## Bound runs

| Pass | Run | Status evidence SHA-256 |
|---|---|---|
| Think: 20-step, five-branch ToT; MiniMax M3 + Codex critic | `think-1787263310179-5msjl1-modular-spec-blast-radius` | `649156a4ee697dee4d09a7b90c976c671112d7681d96304de0c470a4ae030731` |
| Brainstorm: Codex, Kimi, GLM, MiniMax M3, Claude | `brainstorm-1787263434544-7vowha` | `7ec6eafff6c86577d79072405c1b3a279bc9e96f8d728896d9f3f36f65922242` |
| Tribunal: Codex, Kimi, Claude, GLM; red-team/hybrid | `tribunal-1787263540422-77lasn` | `598173189c37c0682631f77689943e90658428d598cb7366a8b5ab78ff96a67a` |
| Independent final review: Codex | `ask-1787264156663-7q8hlg` | `520ec2c3ad1562b33acdcea79b4f3b02aee5e5b29c118b2a5d202d3c901d6f44` |

The Think primary/critic outputs are additionally bound by
`123ff23ef3639f99f12cd6b28c27f36021bf403235eccc6bd5ee6fb9c2a439df`
and `c2db318a95a3f4962519b4fe34508d706ce65495742606ad59866a828bd5d31c`.
The final independent output is bound by
`41b607ea06f7ab744fefb959b5d495943d6f8842603af7f2dd43cded2a553b0c`.

## Accepted and resolved against local evidence

| Model claim family | Local verification and disposition |
|---|---|
| In-process capabilities are not a sandbox | Accepted. `modular-agon-security-and-distribution.md` explicitly treats executable in-process mods as full-code trust and does not claim OS containment. |
| One immutable generation, single writer, fencing, drain/restart, and safe-mode recovery are required | Accepted. The algorithms are normative in the runtime and blast-radius specs; journal generation/fence fields are executable in `contracts.mjs`. |
| Resolver precedence, collisions, ranges, cycles, yanked/prerelease handling, and frozen-lock behavior must be deterministic | Accepted. Rules are frozen in `modular-agon-contracts-and-evidence.md`; the reference resolver has permutation, semver, collision, reserved-ID, missing-dependency, conflict, and cycle tests. |
| npm integrity is not publisher trust; reserved IDs need provenance policy | Accepted. Trust records bind registry origin, package name, provenance identity/status, source, and exact hashes. Reserved `agon.*` candidates are rejected unless bundled, provenance-verified first-party registry artifacts, or explicitly selected development paths. |
| Public API/private-import and singleton boundaries must be explicit | Accepted. The Mod API is a standalone compile-only contract, the package/exports rules ban private consumer entrypoints, and the kernel owns the sole registrar/services instances. Production enforcement remains a release gate. |
| Executable/declarative profiles and asset containment were missing | Accepted and resolved. Manifest v2 has explicit execution profile, compatibility ranges, asset inventory, safe relative paths, and host conformance checks that prohibit executable contributions in declarative mods. |
| Transitive dependency, lifecycle-script, setup-action, native/Python/WASM, pack, and offline boundaries need contracts | Accepted. The authoring/security/readiness specs freeze these policies; the external fixture and pack-content check are executable evidence. Clean registry/proxy and Linux qualification remain release-environment gates. |
| Persisted records need producer, content, graph, kernel, schema, and receipt identity | Accepted and resolved. Plan/result/session/job envelopes carry owner mod/version/content hash, kernel version, graph hash, contribution ID, payload version/encoding, session/trace IDs, and receipts. |
| Removed mods require per-artifact behavior, tombstones, leases, and GC policy | Accepted. The runtime/readiness specs freeze plan pause, generic result rendering, session tombstones, job generation leases, rollback retention, quota ordering, and explicit purge. |
| Verification metadata and the lifecycle × artifact matrix must be executable, owned, and traceable | Accepted and resolved. JSON Schemas, host/mod authority, runner identity, bounds, evidence hashes, verification receipts, and the 1,480-cell ledger are generated and tested. |
| Surface catalogs will diverge again without one registry and generated conformance | Accepted. Ownership and kill-list evidence map current CLI/TUI/MCP/Cesar/docs catalogs to one future registry projection; current surface counts are generated from AST/source scans. |
| Current `pipeline` means two different workflows | Accepted from source inventory. MCP maps to `pipeline-orchestration`; TUI/Cesar map to `pipeline-delivery`, each with a separate physical package and compatibility alias. |
| Performance requirements need measured ceilings | Accepted and resolved for macOS. Startup, RSS, package, 1,000-mod resolver, representative workflow, and 300-block TUI measurements set absolute and relative budgets. Linux execution is externally blocked, not guessed. |
| Physical ownership for dedup, engine data, probes, browser/native host, and every user workflow must be fixed | Accepted. The generated 852-row ownership ledger maps every occurrence to 2 kernel/API, 11 hidden support, or 36 physical toggleable packages. |

## Rejected or narrowed claims

| Claim | Adjudication |
|---|---|
| npm/global/npx automatically provide Agon's canonical lock, signing, rollback, or offline semantics | Rejected. The specs define Agon-owned state and treat npm as an adapter/source only. |
| `packages/dedup` is the current external boundary | Rejected after source inspection; the relevant external package/current bundling facts differ. Ownership follows the generated package/source inventory, not the model's guess. |
| Copying JSON in tsup is governed by `sideEffects: false` | Rejected as a category error. Static asset inclusion/integrity and runtime module side effects are separate contracts. |
| Every Python probe should automatically become its own user-toggleable mod | Rejected. Physical ownership is assigned by user-facing capability; hidden implementation sidecars remain hidden support or assets where appropriate. |
| A benign compatible hash change may be silently accepted | Rejected. Compatibility may permit selection during an explicit transaction, but a frozen graph/content hash never silently changes. |
| Windows mechanisms must be frozen for v1 | Narrowed by Raphael's decision: v1 supports macOS and Linux; Windows is explicitly deferred and must fail compatibility early. |
| A particular lock library or OS primitive should be selected from model memory | Rejected without implementation evidence. The spec freezes behavioral fencing/atomicity contracts; production selects and proves an implementation per supported OS. |

## Genuinely external or future decisions

- Minimum named macOS/Linux OS releases are product/release inputs; Node >=22 and
  darwin/linux arm64/x64 architecture cells are frozen.
- Linux runtime, filesystem, native/path, and performance receipts need an
  available Linux runner.
- Public registry namespace transfer, key-rotation, and live revocation service
  operations are required before third-party public distribution, but cannot be
  exercised against an unavailable service in this specification-only task.
- Published-tarball external-repository compatibility, proxy/private-registry,
  offline-cache, and upgrade/rollback promotion are implementation/release gates;
  the local compile and dry-pack prototypes remove specification ambiguity but do
  not falsely claim those systems exist.

Checked dimensions: architecture, package graph, author API, resolver, trust,
permissions, assets, build/pack, install/update/rollback, state/persistence,
concurrency, safe mode, every runtime projection, docs, performance, platform,
migration, and verification. Locally resolvable open dimensions: none.
