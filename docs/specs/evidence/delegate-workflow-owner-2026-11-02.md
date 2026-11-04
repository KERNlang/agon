# Delegate workflow ownership evidence

Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.
Branch: `refactor/modular-delegate-workflow-owner`.
Status: full repository gate and final packed runtime/type checks passed.

Physical Forge owns Delegate execution policy and DelegateResult. Legacy Forge
keeps its public signature, registry lookup and working-directory resolution.
Five direct callers remain unchanged. Existing admission checks remain outside
this low-level helper. No dependency, new permission or runtime feature was added.

## Verified checks

- Build/typecheck and 216 focused tests passed before coverage additions.
- Expanded suite passed 218 tests. A subsequent facade cancellation/rejection
  test brought the owner file to 14 passing cases. Generator/roadmap checks pass.
- Restoring the actual legacy implementation makes the ownership assertion fail.
  Removing signal forwarding makes the boundary assertion fail. Both temporary
  mutations were restored before qualification.
- Packed public runtime and strict declaration compilation pass. Removing the
  packed Delegate declaration makes compilation fail. Callback arguments, usage
  identity, response cleaning and rejection identity are checked at runtime.
- Release-set and supply-chain generation/checks/self-tests pass. Forge and kernel
  payloads changed among 49 modular packages. Other 47 changes are archive hashes,
  not changed package contents. Local Node26/npm11 evidence does not replace
  canonical Node22/npm10 or native platform release qualification.

## Independent review

One isolated Agon Codex review found no concrete source-level regression.
Evidence gaps were checked locally: Forge already declares mod-forge; Core's
DispatchResult directly re-exports the Engine Runtime type; full build/typecheck
compiles callers. The session-root test owns its override in an isolated file and
resets it in finally. Facade cancellation/rejection and packed consumer coverage
were added. No second model review was used.

The first packed checks were rejected: skipLibCheck hid a missing declaration,
and linked dependencies also resolved the workspace Forge copy. The corrected
fixture preserves symlink resolution, includes existing external type dependencies
and checks library declarations. All failed receipts remain archived.

The first full gate failed: 70 failed, 12,372 passed, 30 skipped, 16 unhandled
errors. Socket binding was denied by the execution sandbox; independent identical
Node probes failed with EPERM inside and passed outside it. Room watcher tests
also failed in that run. A separate real defect was stale generated Forge
manifest hashes. The existing catalog generator corrected 16 owner hashes;
no routes changed. This also changes the kernel payload.

The repair run passed build, 53 focused tests (Delegate, catalog, daemon Jobs,
room watchers), release/supply-chain self-tests and diff checks with socket
permission. Isolated state and provider blockers stayed enabled. A new full
gate subsequently passed; the failed run remains preserved, not reclassified.

Final full gate: 12,465 tests passed, 7 skipped, 734 files passed and 1 skipped.
Build, typecheck, lint, reexport guard, both generator drift checks, release-set
and supply-chain self-tests passed in 863.582 seconds. Final packed runtime and
strict public types passed afterward in 4.083 seconds, including rejection of
a missing declaration. Both runs recorded zero provider launches.

Repository-required `npm run docs:modes` completed with no documentation drift.
After that rebuild, another isolated packed check passed in 4.066 seconds with
zero provider launches. The docs command itself has no isolated run receipt.

## Durable evidence index

Archive: `/Users/ra/dev/modular-agon-remediation/`. Run IDs below have `.log` and
`.receipt.json` files with exact commands, exit codes and provider counts.
No providers launched in test/qualification runs. Do not delete the archive
without Raphael's approval.

| Run or artifact | SHA-256 of log (or input packet) |
| --- | --- |
| delegate-owner-build-focused-20261102 | `a7ab705d4ae603b7bf7ce089b5d98fce6b2763a2e96621de6b75d3ae756d2c34` |
| delegate-owner-complete-focused-20261102 | `e6ed5ccb953230e47589077066f004fbdb4983e21f9f67be943348e37d4dddd3` |
| delegate-owner-legacy-negative-20261102 | `a1a7155e942112be9b262149d691ae03963588dba449bfc37536008617aad28a` |
| delegate-owner-signal-negative-20261102 | `716757af45bd0c967667ea2a63b91b8b229073ef356a407667dfcf4937668e13` |
| delegate-owner-review-fixes-20261102 | `760fe3dcc815f3edf9054563ec10cc844b46e711e5ea7e4ba51ab69ae31d1f6b` |
| delegate-owner-packed-strict-20261102 | `99f3a76ca02ae2b3063f09b0ac2d3dfc3de09fcfb6a31771437d4c1c96de58a8` |
| delegate-owner-release-refresh-20261102 | `fc99be00f4dc7d7050754199ca93cb3c3f8b3c2fc0cb76e625326c1bff9804e4` |
| delegate-owner-final-gates-20261102 (failed) | `a5e117a5468e4dda20c5eff20c7d97e61515b6300e0448d8f98615a889f85d37` |
| delegate-owner-catalog-repair-20261102 | `d0929366a215f4eed41c0e8273db700e36636a2d9e38eb74d5ae7fe0e7e67ed7` |
| delegate-owner-qualified-gates-20261102 | `ef63b8325fa928485fe72066c5f2a57dc2d7cd15ad39715a1b3a7a28ed01c6d4` |
| delegate-owner-final-packed-20261102 | `1491f3dd41851cad6156bc6c491fe046d0ad413474c33b301c4a4911222d5724` |
| delegate-owner-postdocs-packed-20261102 | `277f803505861853b1ac6476a33c4366005715c083dfe5365576a697236ab360` |
| delegate-workflow-owner-review-input.txt | `ed8c953d3d6081d15fa27f1d2da18594a496a74f1dd797270b3c00e1c60cc82e` |
| delegate-workflow-owner-codex-review | `bed464746554a5ab96ec0530884cc88ce6c01db86ccfab70560ea5c6b6d5663d` |

Packed tarball: `delegate-owner-packed-20261102.tgz`, SHA-256
`deb1a0635e3259ba816713141732899f0584081e145be7cb08701f24882f27a6`.
Only Forge mod is extracted from its tarball; other dependencies use local builds.
This is not a clean distribution install or full modular acceptance receipt.

## Reproduce

With isolated home/cache and provider blockers:

```sh
npm run build && npm run typecheck
npm run test:ts -- tests/unit/modular-delegate-workflow-owner.test.ts tests/unit/plan-mode-executor.test.ts tests/unit/modular-plan-step-admission.test.ts tests/unit/pr-text.test.ts
npm test && npm run lint && npm run guard:reexports
node scripts/spec/generate-modular-first-party-packages.mjs --check
npm run test:modular-release && npm run test:modular-supply-chain
```

Full gate and final packed execution passed before publication. This evidence
qualifies this bounded ownership change, not the full modular release.
