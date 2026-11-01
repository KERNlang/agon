# Forge definition destinations

Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.

Correct eleven S5 implementation destinations from the generic Forge index:
eight configuration keys point to `schemas/config.schema.json`; FitnessResult
points to `src/scoring.ts`; ForgeEvent and GauntletResult point to `src/types.ts`.
All paths are within `packages/mod-forge`.

Historical source locators, compatibility adapters and authority labels stay
unchanged. This describes definition locations, not runtime retirement.

## Verification

Raw logs and receipts remain in `/Users/ra/dev/modular-agon-remediation/`.
Run IDs identify `.log` and `.receipt.json` files. SHA-256 values bind logs.

| Run | Result | Log SHA-256 |
| --- | --- | --- |
| forge-definition-ledger-red-20261101 | Exit 1: original index destination rejected | 35f4db387793ed472f8cdaef59abe53be72492e9e6a9dac5e8f7396898d482b0 |
| forge-definition-ledger-green-20261101 | Exit 0: four focused suites, generator check, typecheck | 49c1d8d6402ed9270ed62b0703a8b90b322dd6057c6be2a7a7e0d9aaa96679 |
| forge-definition-ledger-full-20261101 | Stopped after sandbox socket EPERM; exit -15, not acceptance | 029cd33516910ffc7668a6eb3c284faef700a4a81307888d5c2b54b8b99afbfa |
| forge-definition-ledger-qualified-20261101 | Exit 0; 1032.97s; zero provider launches | e68f8a9bbef8744ffefe48b20b238645c6047f9c58578c62970124b6aef3ddcc |

Full permitted run: build, generated docs, release-set/SBOM generation,
typecheck, 12,452 passing tests (7 skipped), lint, re-export guard,
release/supply-chain self-tests, ledger drift check and diff check.
The external receipt records the exact command. Local sockets were allowed;
isolated homes, provider blockers and no-login preload remained active.

Codex-only isolated Agon review: no blocking finding. Packet SHA-256:
`0e09f8de26c553770435e8f3fc7bba51d914f72bf959ed1a74ceb47ee3180b5f`.
Review log SHA-256:
`e965da1bf0b60a18cd8681a48b6bd7cef70fc68abacd3d621efc13f334cf1f50`.
The initial review failed before dispatch because nested sandbox creation was
denied; the permitted retry used the identical packet.

Review noted that the regression alone does not establish historical identity
or generator freshness. Separate checks compared all 348 assignment objects
to base with only implementationPaths omitted, verified exact equality,
counted exactly eleven changed Forge destinations, recomputed the Forge
assignment hash and ran the generator with `--check`. All passed.

## Reproduce and limits

```sh
node scripts/spec/generate-modular-first-party-migration-ledger.mjs --check
./node_modules/.bin/vitest run tests/unit/modular-forge-type-boundary.test.ts tests/unit/modular-forge-settings.test.ts tests/unit/modular-plan-migration-ledger.test.ts tests/unit/modular-research-citation-owner.test.ts
```

The new test verifies actual schema properties and TypeScript declarations,
not just directory existence. Existing import-symbol identity tests remain.
No production source or public contract changes. All 49 package payload hashes
and inventories matched base. Generated archive metadata churn was preserved
outside Git in `forge-definition-ledger-generated-20261101.patch` and excluded
from this evidence-only PR. This is not integrated clean-checkout release
qualification and does not settle remaining ownership assignments.
