# Retirement guard negative controls

Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.
Scope: existing kill-list verifier and S9 invocation. No runtime changes.

KL-006, KL-007 and KL-009 now have in-memory negative controls. Every
kill-list ID must have a control. S9 runs the verifier with `--self-test`.
Existing retirement predicates remain unchanged.

## Verification

Durable raw evidence: `/Users/ra/dev/modular-agon-remediation/`.
Run IDs identify `.log` and `.receipt.json` files. SHA-256 below binds logs.

| Run | Result | Log SHA-256 |
| --- | --- | --- |
| retirement-controls-red-20261101 | Exit 1; missing controls named KL-006/007/009 | 677e83c9427759aae25f2511a877c72d027ced40b98590b01305369a12f8c66b |
| retirement-controls-green-20261101 | Exit 0; both self-tests | 4fb1563ed0c54229eff69742cb10c53749c9bc8d7f6da1e4b33d3cf920f8bcf8 |
| retirement-controls-full-20261101 | Exit 0; 915.683 seconds; zero provider launches | 99ed391cbb176a1f62f6545cb5ed12412d7d571d6c1eb1c88ed37f70f58afe65 |

Full run: build, generated mode docs, release-set and supply-chain generation,
typecheck, repository tests (12,451 passed, 7 skipped), lint, re-export guard,
release and supply-chain self-tests, kill-list self-test, S9 self-test and
diff whitespace check. Exact command is in the external receipt.

Codex-only isolated Agon review found no blocking issue. Packet SHA-256:
`2f7be740148c3ef30f58aeeaf2db4a3458031584686d7713b4f0d26731593f6f`.
Review log SHA-256:
`b9a5c14614b0c869069baf88b8702070a04ed12a0048464e040f821f0e843831`.

## Reproduce

```sh
node scripts/spec/verify-modular-kill-list.mjs --self-test
node scripts/spec/qualify-modular-agon-slice9.mjs --self-test
```

Removing the three added controls must fail the coverage assertion. Replacing
each corresponding predicate with `true` must fail its named negative control;
three in-memory mutants were checked separately.

## Limits

These controls test the existing textual predicates, not all possible semantic
ways to reintroduce retired behavior. S9 self-test is not full S9 qualification.
This is worktree verification, not integrated clean-checkout release acceptance.
Generated archive metadata was excluded from this test-only change after all
49 package payload hashes and file inventories compared equal to base. The
generated metadata diff is retained as
`retirement-controls-generated-20261101.patch` in the external evidence folder.
Launcher metadata changed because it embeds dependency archive identities.
