# Plan proposal failure reporting

Qualified runtime subject: `b3aef1598ac57ffae49ae030c4820f573ac6679c`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Branch: `fix/modular-plan-proposal-failure`.
Native macOS arm64, Node 26.12.1, npm 11.20.0.

## Change and negative control

Cesar caught proposal failures but returned `PLAN_PROPOSED`. The existing catch
now returns `PLAN_ERROR` with `DELEGATION_BREAK`. Warnings, healthy behavior and
persisted data remain unchanged. No dependency or ownership changes.

Three tests in `tests/unit/cesar-session.test.ts` exercise real storage failure,
display failure and a non-Error state callback failure. All three failed before
the fix, receiving the success marker. Afterward all 72 tests in that file passed.
Tests check stop/error markers, callback counts and retained plan/file contents.

The stop marker remains compatible with the session loop. Publication can leave
a saved proposal if display fails; this change reports failure, not rollback.
It does not claim to repair inherited partial-publication behavior.

## Verification receipts

Durable archive: `/Users/ra/dev/modular-agon-remediation`.
Each runtime ID below has `.log` and `.receipt.json`. Receipts record the exact
command, duration, exit, log hash and provider launches. Retain this archive.
All runs recorded zero provider launches. The red run intentionally exited 1.

| Runtime ID | Result | Log SHA-256 |
| --- | --- | --- |
| plan-proposal-failure-red-20261030 | 3 expected failures, 69 pass | 83276b6f3df49f3d22a86deaeca617b456ede8498aec29f9f5238413d45695a0 |
| plan-proposal-failure-green-20261030 | 72 pass | b988fb908401df129c241a864ebd6942c8a51d20f250a87feef196a5e24b8049 |
| plan-proposal-failure-gates-20261030 | build, types, lint, re-export guard, diff check | 03175e0c71907b204c39eb9ee42a224b24f4546481f9190e3fb4296bbc228da9 |
| plan-proposal-failure-full-20261030 | full suite, release/SBOM, installed candidate | c08d55ec6aa9eababd6e0949cee9745b86117da842893d0f9d90d9d397ecf085 |
| plan-proposal-failure-clean-build-20261030 | offline frozen install and build gates | 0a73b3236815d644159554db1ebb36debd923e2307701387bd3312ef3913e242 |
| plan-proposal-failure-clean-runtime-20261030 | exact-commit full replay | 823460d9540b2dcf53b9996b2ab42c9c24ac6a11cb203c87fb4eea2f729f0c22 |

Both full runs passed 12,115 tests; 7 skipped. Both installed runs passed 129
checks with 15 candidate packages, cache-deletion survival and idempotent setup.
Clean build took 251.496 seconds; clean runtime took 760.86 seconds.
Clean checks ran before and after. No metadata regeneration occurred there.
Existing source-contamination checks returned ignored=[], untracked=[],
unstaged=[] with no extra exclusions.

## Independent review

Isolated Codex-only Agon source review returned no findings. Reviewer ran no
tests. Its claims were checked against the proposal persistence order and
session-loop stop-marker handling.

- Input: `plan-proposal-failure-review-input.txt`, SHA-256
  `56ecdcb9e78a8d1f76bc5ad18a0def85877361341da5158ef439854e6b9e1f8f`.
- Log: `plan-proposal-failure-codex-review.log`, SHA-256
  `2c242e5f6edadf755c45cc60645be95dfd4d17da5e6d47fdfbb63f0b2d04791e`.

## Reproduce and limits

Use a detached clean checkout of the runtime subject above. Run locked offline
`npm ci --ignore-scripts --no-audit --no-fund` with the populated qualification
cache, then build, typecheck, lint, guard:reexports and the migration-ledger
generator with `--check`. Run `test:modular-release`,
`test:modular-supply-chain`, `npm test`, and
`node scripts/spec/verify-modular-npx.mjs --no-write` in isolated homes with
provider blockers. Set both AGON_QUALIFICATION_NPM_CACHE and AGON_S9_NPM_CACHE
to the qualification cache. Exact commands are in the archived receipts.

This is one verified fix, not full modular acceptance. Core compatibility
retirement and broader ownership work remain. Other native platforms, Node
versions, live providers and publishing remain separate release evidence.
No global installation, personal-state changes or automatic merge occurred.
